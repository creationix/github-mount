var vm = require('vm');
var mine = require('js-linker/mine.js');
var pathJoin = require('js-linker/pathjoin.js');
module.exports = compiler;

function compiler(repo, root) {
  // Cached modules by path
  var cache = {};
  // Callback lists per path
  var pending = {};
  compile.root = root;
  return compile;

  function compile(path, callback) {
    if (!callback) return compile.bind(this, path);

    var module = cache[path];
    if (module) return callback(null, module);

    if (pending[path]) {
      return pending[path].push(callback);
    }
    pending[path] = [callback];

    var js, deps;
    return repo.pathToEntry(root, path, onEntry);

    function onEntry(err, entry) {
      if (!entry) return flush(err);
      repo.loadAs("text", entry.hash, onJs);
    }

    function onJs(err, result) {
      if (err) return flush(err);
      js = result;
      deps = mine(js);
      parallel(deps.map(function (dep, i) {
        var depPath = pathJoin(path, "..", dep.name);
        deps[i].path = depPath;
        return compile(depPath);
      }), onDeps);
    }

    function onDeps(err) {
      if (err) return flush(err);
      for (var i = deps.length - 1; i >= 0; i--) {
        var dep = deps[i];
        js = js.substr(0, dep.offset) + dep.path + js.substr(dep.offset + dep.name.length);
      }
      var module = cache[path] = compileModule(js, root + ":" + path);
      flush(null, module);
    }

    function flush() {
      var callbacks = pending[path];
      delete pending[path];
      for (var i = 0, l = callbacks.length; i < l; i++) {
        callbacks[i].apply(this, arguments);
      }
    }
  }

  function compileModule(js, filename) {
    var exports = {};
    var module = {exports:exports};
    var sandbox = {
      console: console,
      require: fakeRequire,
      module: module,
      exports: exports,
      Buffer: Buffer
    };
    vm.runInNewContext(js, sandbox, filename);
    // TODO: find a way to run this safely that doesn't crash the main process
    // when there are errors in the user-provided script.

    // Alternative implementation that doesn't use VM.
    // Function("module", "exports", "require", js)(module, exports, fakeRequire);
    return module.exports;
  }

  function fakeRequire(name) {
    if (name in cache) return cache[name];
    throw new Error("Invalid require in sandbox: " + name);
  }


}

// Run several continuables in parallel.  The results are stored in the same
// shape as the input continuables (array or object).
// Returns a new continuable or accepts a callback.
// This will bail on the first error and ignore all others after it.
function parallel(commands, callback) {
  if (!callback) return parallel.bind(this, commands);
  var results, length, left, i, done;

  // Handle array shapes
  if (Array.isArray(commands)) {
    left = length = commands.length;
    results = new Array(left);
    if (!length) return callback(null, results);
    for (i = 0; i < length; i++) {
      run(i, commands[i]);
    }
  }

  // Otherwise assume it's an object.
  else {
    var keys = Object.keys(commands);
    left = length = keys.length;
    results = {};
    if (!length) return callback(null, results);
    for (i = 0; i < length; i++) {
      var key = keys[i];
      run(key, commands[key]);
    }
  }

  // Common logic for both
  function run(key, command) {
    command(function (err, result) {
      if (done) return;
      if (err) {
        done = true;
        return callback(err);
      }
      results[key] = result;
      if (--left) return;
      done = true;
      callback(null, results);
    });
  }
}
