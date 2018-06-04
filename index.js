const WorkerBase = require('yeedriver-base/WorkerBase');

const dgram = require('dgram');
const os = require('os');
const P = require('bluebird')


const _ = require('lodash');

const config = require(process.cwd() + '/ioscfg.json').config || {};

const cmd = {
    REQUEST_HEART_BEAT:0x0001,
    RESPONSE_HEART_BEAT:0x0002,
    REQUEST_CONTROL:0x0003,
    RESPONSE_CONTROL:0x0004,
    REQUEST_DEVICE:0x0005,
    RESPONSE_DEVICE:0x0006,
    REQUEST_SCENE:0x0007,
    RESPONSE_SCENE:0x0008,
    REQUEST_ROOM:0x0009,
    RESPONSE_ROOM:0x000A,
    REQUEST_FLOOR:0x000B,
    RESPONSE_FLOOR:0x000C,
    RESPONSE_VOICE:0x000E

}

class Gowld extends WorkerBase{
    constructor(maxSegLength, minGapLength){
        super(maxSegLength, minGapLength)

        _.each(os.networkInterfaces(),(item,key)=>{
            if(key!='lo' && item[0] && item[0].mac !== 'ff:00:00:00:00:00' && item[0].mac !== '00:00:00:00:00:00' && item[0].family=='IPv4'){
                this.network = item[0];
                return false;
            }
        });

        this.scenes = [];
        _.each(config.specConfig || {},(value,key)=>{
            if(!value.mode){
                this.scenes.push({
                    id:key,
                    name:value.name
                })
            }

        })



    }

    getCheck (buffer) {
        let check = 0;
        for(let i=1;i<buffer.length-1;i++){
            check ^= buffer[i];
        }
        buffer[buffer.length-1] = check;
        return buffer;

    }

     getResponse (data) {
        let cmdId = cmd[data.type];


        let length = Buffer.byteLength(JSON.stringify(data), 'utf8');

        let dataBuf = Buffer.alloc(6+length);
        dataBuf.writeUInt8(0xaa,0);
        dataBuf.writeUInt16BE(length,1);
        dataBuf.writeUInt16BE(cmdId,3);
        dataBuf.write(JSON.stringify(data),5,'utf8');

         let check = 0;
         for(let i=1;i<dataBuf.length-1;i++){
             check ^= dataBuf[i];
         }
         dataBuf[dataBuf.length-1] = check;

        return dataBuf;
    }

    initDriver(options){

        this.options = options;

        this.devices = _.mapValues(options.sids,(item)=>{
            return {
                WI1:{}
            }
        })

        if(!this.server){
            this.server = dgram.createSocket('udp4');

            this.server.on('close',()=>{
                console.log('socket已关闭');
            });

            this.server.on('error',(err)=>{
                console.log(err);
            });

            this.server.on('listening',()=>{
                console.log('socket正在监听中...');
                // server.setBroadcast(true);
            });

            this.server.on('message',(msg,rinfo)=>{

                let obj = {}

                try{
                    obj = JSON.parse(msg.toString());
                }
                catch (e) {
                    return;
                }

                if(obj.sn && !this.options.sids[obj.sn]){
                    let devices = {};
                    devices[obj.sn] = {
                        uniqueId:'xb',
                        groupId:".",
                    }
                    this.inOrEx({type: "in", devices: devices})
                }

                console.log(`receive message from ${rinfo.address}:${rinfo.port}`);
                let res = {
                    "type":"RESPONSE_TCP"
                }

                this.server.send(`{"type":"RESPONSE_TCP","data":{"ip":"${this.network.address}","port":8888,"company":"usky"}}`,rinfo.port,rinfo.address)


                // if(sended>=0){
                //     sended += 1;
                //                 }

                // const socket = dgram.createSocket('udp4');
                //
                // socket.bind(7777, () => {
                //     socket.setMulticastInterface('0.0.0.0');
                //
                // });

            });

            this.server.bind(6666,"0.0.0.0");
        }




        if(!this.net){
            this.net  = require('net');

            this.net.createServer((sock) =>{

                // 我们获得一个连接 - 该连接自动关联一个socket对象
                console.log('CONNECTED: ' +
                    sock.remoteAddress + ':' + sock.remotePort);

                // 为这个socket实例添加一个"data"事件处理函数
                sock.on('data', (data) => {
                    let parseData = _.drop(data,5);
                    parseData = _.dropRight(parseData);

                    let request = {};
                    try{
                        request = JSON.parse(Buffer.from(parseData).toString('utf8'));
                    }
                    catch (e) {
                        return;
                    }

                    if(!this.options.sids[request.sn]){
                        return;
                    }

                    let retObj;
                    switch (request.type){
                        case "REQUEST_HEART_BEAT":
                            retObj =  this.getResponse({
                                type:"RESPONSE_HEART_BEAT"
                            });

                            break;
                        case "REQUEST_DEVICE":
                            retObj =  this.getResponse({
                                type:"RESPONSE_DEVICE",
                                data:[]
                            });
                            break;
                        case "REQUEST_SCENE":
                            retObj =  this.getResponse({
                                type:"RESPONSE_SCENE",
                                data:this.scenes
                            });
                            break;

                        case "REQUEST_ROOM":
                            retObj =  this.getResponse({
                                type:"RESPONSE_ROOM",
                                data:[]
                            });
                            break;
                        case "REQUEST_FLOOR":
                            retObj =  this.getResponse({
                                type:"RESPONSE_FLOOR",
                                data:[]
                            });
                            break;

                        case "REQUEST_CONTROL":

                            if(this.devices[request.sn] && request.data && request.data[0]){

                                this.devices[request.sn]["WI1"] = {
                                    type:"triggerScene",
                                    targetScene:request.data[0].id,
                                    dateTime:new Date()
                                }
                                this.emit('RegRead',{devId:request.sn ,memories:this.autoReadMaps[request.sn]});

                            }

                            retObj =  this.getResponse({
                                type:"RESPONSE_CONTROL",
                                "code":0,
                                "msgVoice":"场景已启动",
                                data:[]
                            });
                            break;

                        default:
                            break;

                    }

                    console.log('DATA ' + sock.remoteAddress + ': ' + data);
                    // 回发该数据，客户端将收到来自服务端的数据
                    sock.write(retObj || '');
                });

                // 为这个socket实例添加一个"close"事件处理函数
                sock.on('close', function(data) {
                    console.log('CLOSED: ' +
                        sock.remoteAddress + ' ' + sock.remotePort);
                });

            }).listen(8888, "0.0.0.0");

        }

        this.setRunningState(this.RUNNING_STATE.CONNECTED);

        this.setupEvent();

    }

    ReadWQ(mapItem,devId){
        return [];
    }

    ReadWI(mapItem,devId){
        const retObj = [];
        for (let i = mapItem.start; i <= mapItem.end; i++) {
            retObj.push(this.devices[devId]["WI"+i.toString()]);
        }
        return P.resolve(retObj);
    }
}

module.exports = new Gowld();