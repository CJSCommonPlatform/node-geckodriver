var path = require('path');

// add the geckodriver path to process PATH
process.env.PATH += path.delimiter + path.join(__dirname, 'geckodriver');

// support win32 vs other platforms
exports.path = process.platform === 'win32' ? path.join(__dirname, 'geckodriver', 'geckodriver.exe') : path.join(__dirname, 'geckodriver', 'geckodriver');

// specify the version of geckodriver
exports.version = '0.20.0';

exports.start = function(args) {
  exports.defaultInstance = require('child_process').execFile(exports.path, args);
  return exports.defaultInstance;
}

exports.stop = function () {
  if (exports.defaultInstance !== null){
    exports.defaultInstance.kill();
  }
}
