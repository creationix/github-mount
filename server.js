var accessToken = process.env.TOKEN;
var jsGithub = require('js-github');
var vm = require('vm');
var handleRequest = require('git-publish-http');
var gitPublisher = require('git-publisher');
var http = require('http');
var mine = require('js-linker/mine.js');
var pathJoin = require('js-linker/pathjoin.js');
var hashCache = require('./memcache.js');
var addCache = require('./addcache.js');

var repos = {};

var server = http.createServer(onRequest);
server.listen(process.env.PORT || 8000, function () {
  console.log("Server listening at http://localhost:%s/", server.address().port);
});

function onRequest(req, res) {

  var match = req.headers.host && req.headers.host.match(/^(.*?)\.[^.]+(?:\.com|\.org)?$/);
  var host = match && match[1];
  var name = host;
  if (!host) {
    res.statusCode = 404;
    return res.end("Missing Host header");
  }
  var ref = "refs/heads/master";
  if (host.substr(0, 8) === "current.") {
    ref = "refs/tags/current";
    name = host.substr(8);
  }

  var repo = repos[host];
  if (!repo) {
    repo = repos[host] = jsGithub("creationix/" + name, accessToken);
    repo.handleCommand = handleCommand;
    gitPublisher(repo);
    addCache(repo, hashCache);
    repo.getRoot = rootCheck(repo, ref, onRequest.bind(this, req, res));
    return;
  }

  // Log requesst
  var end = res.end;
  res.end = function () {
    console.log(req.method, req.url, res.statusCode);
    return end.apply(this, arguments);
  };

  repo.getRoot(function (err, root) {
    if (err) throw err;
    handleRequest(repo, root, req, res);
  });

}

function handleCommand(req, callback) {
  var repo = req.repo;
  var root = req.root;
  var name = req.name;

  repo.pathToEntry(root, "filters", function (err, entry) {
    if (err) return callback(err);
    if (!entry || entry.mode !== 040000) {
      return callback(new Error("Missing filters folder"));
    }
    if (!repo.filterCompiler || repo.filterCompiler.root !== entry.hash) {
      repo.filterCompiler = compiler(repo, entry.hash);
    }
    repo.filterCompiler(name + ".js", function (err, result) {
      if (err) return callback(err);
      if (!result) return callback(new Error("No such filter: " + name));
      result(req, callback);
    });
  });

}

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
      exports: exports
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

function rootCheck(repo, refName, callback) {
  var root;
  var last = Date.now();
  // Current is a non-throttled check
  if (refName === "refs/tags/current") {
    process.nextTick(callback);
    callback = null;
    return function (callback) {
      var now = Date.now();
      if (root && (now - last) < 500) return callback(null, root);
      last = now;
      repo.readRef(refName, callback);
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
