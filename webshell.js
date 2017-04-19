/**
 * Created by xuezhongxiong on 2017/4/19.
 */
'use strict';
const exec = require('child_process').exec;

const ansiHTML = require('ansi-html');
const SocketIO = require('socket.io');

//存储所有stream的集合
const streams = {};

module.exports = {watchFile, watchProcess, init};

function init(httpServer) {
  const io = SocketIO(httpServer);

  io.on('connection', function (socket) {
    socket.on('sub', function (id) {
      if (!streams[id]) return socket.emit('line', `该订阅id不存在: ${id}`);

      //管道函数，收到流的line事件则将内容转成html格式然后触发客户端的line事件
      const pipe = line => socket.emit('line', ansiHTML(line));

      //订阅流的line事件
      streams[id].on('line', pipe);

      //客户端断连时取消订阅事件
      socket.on('disconnect', () => {
        if (streams[id]) streams[id].removeListener('line', pipe);
      });
    });
  });
}


/**
 * 用tail -f读文件
 * @param file
 * @return id
 */
function watchFile(file) {
  return watchProcess(`tail -f ${file}`);
}

/**
 * 自定义的命令行，比如pm2 logs 0
 * @param cmd
 * @return id
 */
function watchProcess(cmd) {
  return watchStream(exec(cmd).stdout);
}

/**
 * 对流做一些额外处理
 * @param stream
 * @return id
 */
function watchStream(stream) {
  const id     = Date.now();
  streams[id]  = stream;
  stream._buff = '';

  //处理流的data事件，使其按行(\n结尾)来触发自定义的line事件
  stream.on('data', data => {
    stream._buff += data;
    let lines    = stream._buff.split('\n');
    stream._buff = lines.pop();
    lines.forEach(line => stream.emit('line', line));
  });
  stream.on('end', function () {
    stream.emit('data', 'stream end.\n');
    delete streams[id];
  });
  stream.on('error', function (err) {
    stream.emit('data', `stream error: ${err.message}\n`);
    delete streams[id];
  });

  //定期检查这个流有没有订阅者，没有就取消引用
  const intervalId = setInterval(function () {
    if (stream.listenerCount('line') === 0) {
      clearInterval(intervalId);
      delete streams[id];
    }
  }, 30 * 1000);

  return id;
}

//demo部分，加入伪时间流，定期输出当前时间
const EventEmitter = require('events').EventEmitter;
const timeEmitter  = new EventEmitter();
streams.time       = timeEmitter;

//定期触发line事件
setInterval(() => {
  timeEmitter.emit('line', new Date().toLocaleString());
}, 1000);