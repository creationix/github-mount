var leveldown = require('leveldown');
var msgpack = require('msgpack-js');

module.exports = function (path, callback) {
  var db = leveldown(path);
  var hashCache = { get: get, set: set };
  db.open(function (err) {
    if (err) return callback(err);
    callback(null, hashCache);
  });

  function get(hash, callback) {
    db.get(hash, function (err, buffer) {
      if (buffer === undefined) return callback();
      var object = msgpack.decode(buffer);
      callback(null, object);
    });
  }

  function set(hash, object, callback) {
    var buffer = msgpack.encode(object);
    db.put(hash, buffer, callback);
  }
};