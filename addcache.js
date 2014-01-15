module.exports = addCache;
function addCache(repo, hashCache) {
  var loadAs = repo.loadAs;
  var load = repo.load;
  var pending = {};

  repo.loadAs = loadAsCached;
  repo.load = loadCached;

  function loadAsCached(type, hash, callback) {
    if (!callback) return loadAsCached.bind(this, type, hash);
    if (hash in pending) return pending[hash].push(onObject);
    pending[hash] = [onObject];
    var object;
    hashCache.get(hash, onCache);
    function onCache(err, result) {
      if (err) return onDone(err);
      if (result) {
        if (result.type !== type) return onDone(new Error("Type mismatch"));
        object = result;
        return onDone();
      }
      return loadAs.call(repo, type, hash, onLoad);
    }
    function onLoad(err, result) {
      if (result === undefined) return onDone(err);
      object = {type: type, body: result};
      hashCache.set(hash, object, onDone);
    }
    function onDone(err) {
      flush(hash, err, object);
    }
    function onObject(err, object) {
      if (!object) return callback(err);
      callback(null, object.body);
    }
  }

  function loadCached(hash, callback) {
    if (!callback) return loadCached.bind(this, hash);
    if (hash in pending) return pending[hash].push(callback);
    pending[hash] = [callback];
    var object;
    hashCache.get(hash, onCache);
    function onCache(err, result) {
      if (err) return onDone(err);
      if (result) {
        object = result;
        return onDone();
      }
      load.call(repo, hash, onLoad);
    }
    function onLoad(err, result) {
      if (result === undefined) return onDone(err);
      object = result;
      hashCache.set(hash, object, onDone);
    }
    function onDone(err) {
      flush(hash, err, object);
    }
  }

  function flush(hash, err, object) {
    var callbacks = pending[hash];
    delete pending[hash];
    for (var i = 0, l = callbacks.length; i < l; i++) {
      callbacks[i](err, object);
    }
  }

}
