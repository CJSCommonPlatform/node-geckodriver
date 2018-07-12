'use strict';

var del = require('del');
var extractZip = require('extract-zip');
var fs = require('fs');
var helper = require('./lib/geckodriver');
var kew = require('kew');
var mkdirp = require('mkdirp');
var path = require('path');
var request = require('request');
var tar = require('tar');
var util = require('util');

var libPath = path.join(__dirname, 'lib', 'geckodriver');
var cdnUrl = process.env.GECKODRIVER_CDNURL || process.env.npm_config_geckodriver_cdnurl || 'https://github.com/mozilla/geckodriver/releases/download';
var configuredfilePath = process.env.GECKODRIVER_FILEPATH || process.env.npm_config_geckodriver_filepath;

// strip trailing '/'
cdnUrl = cdnUrl.replace(/\/+$/, '');
var downloadUrl = cdnUrl + '/v%s/geckodriver-v%s-%s.%s';

var geckodriver_version = process.env.GECKODRIVER_VERSION || process.env.npm_config_geckodriver_version || helper.version;
var platform = 'unknown';
var extension = 'tar.gz';
var executable = 'geckodriver';

switch (process.platform) {
  case 'linux':
    if (process.arch === 'x64') {
      platform = 'linux64';
    } else {
      platform = 'linux32';
    }
    break;
  case 'darwin':
  case 'freebsd':
    if (process.arch === 'x64') {
      platform = 'macos';
    } else {
      console.log('Only Mac 64 bits supported.');
      process.exit(1);
    }
    break;
  case 'win32':
    extension = 'zip';
    executable = 'geckodriver.exe';
    if (process.arch === 'x64') {
      platform = 'win64';
    } else {
      platform = 'win32';
    }
    break;
  default:
    console.log('Unexpected platform or architecture:', process.platform, process.arch);
    process.exit(1);
}


var tmpPath = findSuitableTempDirectory();
var downloadedFile = '';
var promise = kew.resolve(true);

promise = promise.then(function () {
  if (geckodriver_version === 'LATEST')
    return getLatestVersion(getRequestOptions(cdnUrl + '/LATEST_RELEASE'));
});

// Start the install.
promise = promise.then(function () {
  if (configuredfilePath) {
    console.log('Using file: ', configuredfilePath);
    downloadedFile = configuredfilePath;
  } else {
    downloadUrl = util.format(downloadUrl, geckodriver_version, geckodriver_version, platform, extension);
    var fileName = downloadUrl.split('/').pop();
    downloadedFile = path.join(tmpPath, fileName);
    console.log('Downloading', downloadUrl);
    console.log('Saving to', downloadedFile);
    return requestBinary(getRequestOptions(downloadUrl), downloadedFile);
  }
});

promise.then(function () {
  return extractDownload(downloadedFile, tmpPath);
})
  .then(function () {
    return copyIntoPlace(tmpPath, libPath);
  })
  .then(function () {
    return fixFilePermissions();
  })
  .then(function () {
    console.log('Done. geckodriver binary available at', helper.path);
  })
  .fail(function (err) {
    console.error('geckodriver installation failed', err);
    process.exit(1);
  });


function findSuitableTempDirectory() {
  var now = Date.now();
  var candidateTmpDirs = [
    process.env.TMPDIR || process.env.TMP || process.env.npm_config_tmp,
    '/tmp',
    path.join(process.cwd(), 'tmp')
  ];

  for (var i = 0; i < candidateTmpDirs.length; i++) {
    if (!candidateTmpDirs[i]) continue;
    var candidatePath = path.join(candidateTmpDirs[i], 'geckodriver');
    try {
      mkdirp.sync(candidatePath, '0777');
      var testFile = path.join(candidatePath, now + '.tmp');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return candidatePath;
    } catch (e) {
      console.log(candidatePath, 'is not writable:', e.message);
    }
  }

  console.error('Can not find a writable tmp directory, please report issue on https://github.com/giggio/chromedriver/issues/ with as much information as possible.');
  process.exit(1);
}


function getRequestOptions(downloadPath) {
  var options = {uri: downloadPath, method: 'GET'};
  var protocol = options.uri.substring(0, options.uri.indexOf('//'));
  var proxyUrl = protocol === 'https:'
    ? process.env.npm_config_https_proxy
    : (process.env.npm_config_proxy || process.env.npm_config_http_proxy);
  if (proxyUrl) {
    options.proxy = proxyUrl;
  }

  options.strictSSL = !!process.env.npm_config_strict_ssl;

  // Use certificate authority settings from npm
  var ca = process.env.npm_config_ca;

  // Parse ca string like npm does
  if (ca && ca.match(/^".*"$/)) {
    try {
      ca = JSON.parse(ca.trim());
    } catch (e) {
      console.error('Could not parse ca string', process.env.npm_config_ca, e);
    }
  }

  if (!ca && process.env.npm_config_cafile) {
    try {
      ca = fs.readFileSync(process.env.npm_config_cafile, {encoding: 'utf8'})
        .split(/\n(?=-----BEGIN CERTIFICATE-----)/g);

      // Comments at the beginning of the file result in the first
      // item not containing a certificate - in this case the
      // download will fail
      if (ca.length > 0 && !/-----BEGIN CERTIFICATE-----/.test(ca[0])) {
        ca.shift();
      }

    } catch (e) {
      console.error('Could not read cafile', process.env.npm_config_cafile, e);
    }
  }

  if (ca) {
    console.log('Using npmconf ca');
    options.agentOptions = {
      ca: ca
    };
    options.ca = ca;
  }

  // Use specific User-Agent
  if (process.env.npm_config_user_agent) {
    options.headers = {'User-Agent': process.env.npm_config_user_agent};
  }

  return options;
}

function getLatestVersion(requestOptions) {
  var deferred = kew.defer();
  request(requestOptions, function (err, response, data) {
    if (err) {
      deferred.reject('Error with http(s) request: ' + err);
    } else {
      geckodriver_version = data.trim();
      deferred.resolve(true);
    }
  });
  return deferred.promise;
}

function requestBinary(requestOptions, filePath) {
  var deferred = kew.defer();

  var count = 0;
  var notifiedCount = 0;
  var outFile = fs.openSync(filePath, 'w');

  var client = request(requestOptions);

  client.on('error', function (err) {
    deferred.reject('Error with http(s) request: ' + err);
  });

  client.on('data', function (data) {
    fs.writeSync(outFile, data, 0, data.length, null);
    count += data.length;
    if ((count - notifiedCount) > 800000) {
      console.log('Received ' + Math.floor(count / 1024) + 'K...');
      notifiedCount = count;
    }
  });

  client.on('end', function () {
    console.log('Received ' + Math.floor(count / 1024) + 'K total.');
    fs.closeSync(outFile);
    deferred.resolve(true);
  });

  return deferred.promise;
}

function extractDownload(filePath, tmpPath) {
  var deferred = kew.defer();
  console.log('Extracting archive contents to: ' + tmpPath);
  if (filePath.indexOf('.tar.gz') >= 0) {
    tar.extract({
      file: path.resolve(filePath),
      cwd: tmpPath}).then(function (err) {
        if (err) {
          deferred.reject('Error extracting archive: ' + err);
        } else {
          deferred.resolve(true);
        }
      }
    );
  }
  else {
    extractZip(path.resolve(filePath), { dir: tmpPath }, function (err) {
      if (err) {
        deferred.reject('Error extracting archive: ' + err);
      } else {
        deferred.resolve(true);
      }
    });
  }
  return deferred.promise;
}


function copyIntoPlace(tmpPath, targetPath) {
  return del(targetPath, {force: true})
    .then(function() {
      console.log("Copying to target path", targetPath);
      fs.mkdirSync(targetPath);

      // Look for the extracted directory, so we can rename it.
      var files = fs.readdirSync(tmpPath);
      var promises = files.map(function(name) {
        var deferred = kew.defer();

        var file = path.join(tmpPath, name);
        var reader = fs.createReadStream(file);

        var targetFile = path.join(targetPath, name);
        var writer = fs.createWriteStream(targetFile);
        writer.on("close", function() {
          deferred.resolve(true);
        });

        reader.pipe(writer);
        return deferred.promise;
      });
      return kew.all(promises);
    });
}


function fixFilePermissions() {
  // Check that the binary is user-executable and fix it if it isn't (problems with unzip library)
  if (process.platform != 'win32') {
    var stat = fs.statSync(helper.path);
    // 64 == 0100 (no octal literal in strict mode)
    if (!(stat.mode & 64)) {
      console.log('Fixing file permissions');
      fs.chmodSync(helper.path, '755');
    }
  }
}
