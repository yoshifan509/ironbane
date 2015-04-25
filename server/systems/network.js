angular
    .module('server.systems.network', ['ces'])
    .factory('NetworkSystem', [
        'System',
        '$log',
        function(System, $log) {
            'use strict';

            function arraysAreEqual(a1, a2) {
                // TODO make more robust? this is just for transforms right now
                return (a1[0] === a2[0]) && (a1[1] === a2[1]) && (a1[2] === a2[2]);
            }

            function onRecieveTransforms(packet) {
                var sender = this.userId,
                    world = this.world,
                    netEntities = world.getEntities('netRecv');

                // TODO: might be better instead to just find them by ID? not sure which search is faster
                // (and then test they have the netRecv component)
                netEntities.forEach(function(entity) {
                    var netComponent = entity.getComponent('netRecv');

                    // most likely this should be one per client, however perhaps other player owned things
                    // may come
                    if (packet[entity.uuid]) { // && entity.owner === sender) {
                        entity.position.deserialize(packet[entity.uuid].pos);
                        entity.rotation.deserialize(packet[entity.uuid].rot);
                    }
                });
            }

            function onNetSendEntityAdded(entity) {
                this.sendNetState(null, entity);
            }

            function onNetSendEntityRemoved(entity) {
                // since we're syncing up the server's uuid, just send that
                this._stream.emit('remove', entity.uuid);
            }

            var NetworkSystem = System.extend({
                addedToWorld: function(world) {
                    this._super(world);

                    // each world should have its own network stream
                    this._stream = new Meteor.Stream(world.name + '_entities');

                    this._stream.permissions.write(function(eventName) {
                        if (eventName === 'add') {
                            return false;
                        }

                        return true;
                    });

                    this._stream.permissions.read(function(eventName) {
                        return true;
                    });

                    this._stream.on('transforms', onRecieveTransforms.bind(this));

                    world.entityAdded('netSend').add(onNetSendEntityAdded.bind(this));
                    world.entityRemoved('netSend').add(onNetSendEntityRemoved.bind(this));

                    // cache streams for direct user communication
                    this._userStreams = {};
                },
                sendNetState: function(userId, entities) {
                    if (!entities || (entities.length && entities.length === 0)) {
                        return;
                    }

                    if (!angular.isArray(entities)) {
                        entities = [entities];
                    }

                    var stream, packet = {};
                    if (!userId) {
                        // then send it to everyone
                        stream = this._stream;
                    } else {
                        // get user stream
                        stream = this._userStreams[userId];
                        if (!stream) {
                            this._userStreams[userId] = new Meteor.Stream([userId, this.world.name, 'entities'].join('_'));
                            stream = this._userStreams[userId];
                            stream.permissions.write(function() {
                                return this.userId === userId;
                            });
                            // can read anything the server sends
                            stream.permissions.read(function() {
                                return this.userId === userId;
                            });
                        }
                    }

                    // pack them up in a single update
                    entities.forEach(function(entity) {
                        // TODO: specific network serialization
                        var serialized = JSON.parse(JSON.stringify(entity));
                        // we should remove the networking components, and let the client decide
                        delete serialized.components.netSend;
                        delete serialized.components.netRecv;
                        packet[entity.uuid] = serialized;
                    });

                    if (Object.keys(packet).length > 0) {
                        stream.emit('add', packet);
                    }
                },
                update: function() {
                    // TODO: need to send information about add/remove components as well

                    // for now just send transform
                    var entities = this.world.getEntities('netSend'),
                        packet = {};

                    entities.forEach(function(entity) {
                        // we only want to send changed
                        // TODO: later only send "interesting" entities to each client
                        var sendComponent = entity.getComponent('netSend');
                        if (sendComponent._last) {
                            var pos = entity.position.serialize(),
                                rot = entity.rotation.serialize(),
                                lastPos = sendComponent._last.pos,
                                lastRot = sendComponent._last.rot;

                            if (!arraysAreEqual(pos, lastPos) || !arraysAreEqual(rot, lastRot)) {
                                sendComponent._last.pos = pos;
                                sendComponent._last.rot = rot;

                                packet[entity.uuid] = sendComponent._last;
                            }
                        } else {
                            sendComponent._last = {
                                pos: entity.position.serialize(),
                                rot: entity.rotation.serialize()
                            };
                            packet[entity.uuid] = sendComponent._last;
                        }
                    });

                    if (Object.keys(packet).length > 0) {
                        this._stream.emit('transforms', packet);
                    }
                }
            });

            return NetworkSystem;
        }
    ]);