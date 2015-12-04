'use strict';

var fs = require('fs');
var http = require('http');
var debug = require('debug')('instana-nodejs-sensor:agentConnection');
var pidStore = require('./pidStore');

var host = '127.0.0.1';
var port = 42699;
var cmdline;


try {
  cmdline = fs.readFileSync(
    '/proc/' + process.pid + '/cmdline',
    {encoding: 'utf8'}
  );
} catch (err) {
  if (err.code !== 'ENOENT') {
    debug('cmdline could not be retrieved via proc file. Reason: ' + err.message);
  }
}


exports.announceNodeSensor = function announceNodeSensor(cb) {
  var payload = 'pid=' + process.pid;

  if (cmdline) {
    payload += '\ncmdline=' + cmdline;
  }

  var req = http.request({
    host: host,
    port: port,
    path: '/com.instana.plugin.nodejs.discovery',
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': payload.length
    }
  }, function(res) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      cb(new Error('Announce to agent failed with status code ' + res.statusCode));
      return;
    }

    res.setEncoding('utf8');
    var responseBody = '';
    res.on('data', function(chunk) {
      responseBody += chunk;
    });
    res.on('end', function() {
      cb(null, responseBody);
    });
  });

  req.on('error', function(err) {
    cb(new Error('Announce request to agent failed due to: ' + err.message));
  });

  req.write(payload);
  req.end();
};


exports.checkWhetherAgentIsReadyToAcceptData = function checkWhetherAgentIsReadyToAcceptData(cb) {
  checkWhetherResponseForPathIsOkay(
    '/com.instana.plugin.nodejs.' + pidStore.pid,
    function(nodejsSensorLoaded) {
      if (!nodejsSensorLoaded) return cb(false);

      checkWhetherResponseForPathIsOkay(
        '/com.instana.plugin.nodejsapp.' + pidStore.pid,
        cb
      );
    }
  );
};


function checkWhetherResponseForPathIsOkay(path, cb) {
  var req = http.request({
    host: host,
    port: port,
    path: path,
    method: 'HEAD',
  }, function(res) {
    cb(199 < res.statusCode && res.statusCode < 300);
  });

  req.on('error', function() {
    cb(false);
  });

  req.end();
}


exports.sendDataToAgent = function sendDataToAgent(data, cb) {
  var responseCount = 0;
  var responseErrored = false;

  sendAndCheckForCompletion('/com.instana.plugin.nodejs.' + pidStore.pid, data.runtime);
  sendAndCheckForCompletion('/com.instana.plugin.nodejsapp.' + pidStore.pid, data.app);

  function sendAndCheckForCompletion(path, dataToSend) {
    sendData(
      path,
      dataToSend,
      function(error) {
        responseCount++;
        if (error) {
          responseErrored = true;
        }

        if (responseCount === 1 && responseErrored) {
          cb(error);
        } else if (responseCount === 2 && !responseErrored) {
          cb(null);
        }
      }
    );
  }
};


function sendData(path, data, cb) {
  var payload = JSON.stringify(data);
  debug('Sending payload', path, payload);

  var req = http.request({
    host: host,
    port: port,
    path: path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
  }, function(res) {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      cb(new Error('Failed to send data to agent with status code ' + res.statusCode));
    } else {
      cb(null);
    }
  });

  req.on('error', function(err) {
    cb(new Error('Send data to agent request failed: ' + err.message));
  });

  req.write(payload);
  req.end();
}