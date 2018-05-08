import test from 'ava';
import child_process from 'child_process';

test.cb('properly extracts', t => {
  child_process.exec('node index.js', (error, stdout, stderr) => {
    if (error) {
      return t.fail(`exec error: ${error}`)
    }
    t.regex(stdout, /geckodriver binary available/);
    t.is(stderr, '');
    t.end();
  });
});

test('programmatic usage', t => {
  var driver = require('../lib/geckodriver')
  t.is(driver.version, '0.20.1')
});
