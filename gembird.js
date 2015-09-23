/**
 * Copyright 2015 Sébastien Raison <sebastien.raison@l-rd.fr>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
    var spawn = require('child_process').spawn;
    var debug = false;

    function GembirdNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.ready = false;
        node.deviceid = config.deviceid;

        // first we need to check if sispmctl is available and runable, and if the device_id is ok
        sispmctl(['-d', node.deviceid, '-s'], node, function (code, outbuffer, errbuffer) {
            if (code == 0) {
                if (outbuffer.indexOf('4-socket SiS-PM') > -1) {
                    node.log('found device #' + node.deviceid + ' with 4 sockets');
                    node.max_sockets = 4;
                } else {
                    // the only other supported model has 1 socket
                    node.log('found device #' + node.deviceid + ' with 1 socket');
                    node.max_sockets = 1;
                }
                node.status({});
                node.ready = true;
            } else {
                node.error('sispmctl returns ' + code + ': ' + errbuffer);
                node.error('device #' + node.deviceid + ' not found');
                node.status({fill: 'red', shape: 'dot', text: 'device #' + node.deviceid + ' not found'});
                node.ready = false;
            }
        });


        this.on('input', function (msg) {

            if (!node.ready) {
                node.send({topic: 'ERROR', payload: 'node not ready'});
                return;
            }

            var action;
            var socket_n;
            socket_n = msg.payload;
            if (socket_n != 'all' && socket_n > node.max_sockets) {
                node.send({topic: 'ERROR', payload: 'invalid socket number (max ' + node.max_sockets + ')'});
                return;
            }

            switch (msg.topic) {
                case 'ON':
                    action = '-o';
                    break;
                case 'OFF':
                    action = '-f';
                    break;
                    // if we want status we don't need to do really something as this is the default
                case 'STATUS':
                    action = '-q';
                    break;
                default:
                    node.send({topic: 'ERROR', payload: 'command \'' + msg.topic + '\' not recognized'});
                    return;
            }

            sispmctl(['-d', node.deviceid, action, socket_n], node, function (code, outbuffer, errbuffer) {
                if (code == 0) {
                    sispmctl(['-d', node.deviceid, '-g', 'all'], node, function (code, outbuffer, errbuffer) {
                        if (code == 0) {
                            var states = [];
                            for (var i = 0; i < node.max_sockets; i++) {
                                var regex = new RegExp('Status of outlet ' + (i + 1) + ':\\s+on');
                                if (outbuffer.match(regex) != null) {
                                    states[i] = true;
                                } else {
                                    states[i] = false;
                                }
                            }
                            node.send({topic: 'OK', payload: states});
                        } else {
                            node.send({topic: 'ERROR', payload: errbuffer});
                        }
                    });
                } else {
                    node.send({topic: "ERROR", payload: errbuffer});
                }
            });
        });
    }

    function sispmctl(args, node, resultHandler) {
        var cmd;
        var outbuffer = "";
        var errbuffer = "";
        var inerror = false;

        debug && node.log('calling sispmctl ' + args.toString());

        cmd = spawn("sispmctl", args);

        cmd.stdout.on('data', function (data) {
            debug && node.log('stdout: ' + data);
            outbuffer += data;
        });

        cmd.stderr.on('data', function (data) {
            debug && node.log('stderr: ' + data);
            errbuffer += data;
        });

        cmd.on('close', function (code) {
            inerror || resultHandler(code, outbuffer, errbuffer);
        });

        cmd.on('error', function (code) {
            inerror = true;
            node.error(code);
            if (code.errno == 'ENOENT') {
                node.error('sispmctl not found');
                node.status({fill: "red", shape: "dot", text: "sispmctl not found"});
            } else if (code.errno == 'EACCESS') {
                node.error('cannot run sispmctl');
                node.status({fill: "red", shape: "dot", text: "cannot run sispmctl"});
            }
        });
    }
    RED.nodes.registerType("gembird", GembirdNode);
}