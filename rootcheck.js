module.exports = rootCheck;
function rootCheck(repo, refName, callback) {
  var root;
  var last = Date.now();
  // Current is a non-throttled check
  if (refName === "refs/tags/current") {
    process.nextTick(callback);
    callback = null;
    var pending = null;
    return function (callback) {
      if (pending) return pending.push(callback);
      var now = Date.now();
      if (root && ((now - last) < 500)) return callback(null, root);
      pending = [callback];
      last = now;
      repo.readRef(refName, function (err, result) {
        root = result;
        var callbacks = pending;
        pending = null;
        for (var i = 0, l = callbacks.length; i < l; i++) {
          callbacks[i](err, root);
        }
      });
    };
  }
  // Get the root, but throttle request rate.
  var lastCommit = null;
  repo.readRef(refName, onRef);
  return getRoot;

  function getRoot(callback) {
    var now = Date.now();
    if ((now - last) > 5000) {
      last = now;
      repo.readRef(refName, onRef);
    }
    return callback(null, root);
  }

  function onRef(err, ref) {
    if (err) return flush(err);
    if (!ref) return flush(new Error("Missing " + ref));
    if (refName === "refs/tags/current") {
      root = ref;
      return flush();
    }
    if (lastCommit === ref) return;
    lastCommit = ref;
    repo.loadAs("commit", ref, onRoot);
  }

  function onRoot(err, commit) {
    if (err) return flush(err);
    if (err) return console.error(err.stack);
    if (commit) root = commit.tree;
    flush();
  }

  function flush(err) {
    if (err) console.error(err.stack);
    if (!callback) return;
    var cb = callback;
    callback = null;
    cb(err, root);
  }
}

