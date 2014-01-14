var accessToken = process.env.TOKEN;
var jsGithub = require('js-github');
var vm = require('vm');
var handleRequest = require('git-publish-http');
var gitPublisher = require('git-publisher');
var http = require('http');
var mine = require('js-linker/mine.js');
var pathJoin = require('js-linker/pathjoin.js');
var parallel = require('js-git/lib/parallel.js');

var repos = {};

var server = http.createServer(onRequest);
server.listen(process.env.PORT || 8080, function () {
  console.log("Server listening at http://localhost:%s/", server.address().port);
});

function onRequest(req, res) {

  var host = req.headers.host && req.headers.host.match(/^([^.]*)/)[1];
  if (!host) {
    res.statusCode = 404;
    return res.end("Missing Host header");
  }

  var repo = repos[host];
  if (!repo) {
    repo = repos[host] = jsGithub("creationix/" + host, accessToken);
    repo.handleCommand = handleCommand;
    gitPublisher(repo);
    repo.getRoot = rootCheck(repo, onRequest.bind(this, req, res));
    return;
  }

  // Log requests
  var end = res.end;
  res.end = function () {
    console.log(req.method, req.url, res.statusCode);
    return end.apply(this, arguments);
  };

  handleRequest(repo, repo.getRoot(), req, res);
}

function handleCommand(req, callback) {
  var repo = req.repo;
  var root = req.root;
  var name = req.name;

  return compile(repo, root, "filters/" + name + ".js", function (err, result) {
    if (err) return callback(err);
    result(req, callback);
  });

//   function onEntry(err, entry) {
//     if (err) return callback(err);
//     if (!entry) return new Error("Unknown filter: " + name);
//     module.hash = entry.hash;
//     var deps = modDeps[entry.hash];
//     if (deps) {
//       module.deps = deps;
//       return onDeps();
//     }
//     repo.loadAs("text", entry.hash, onJs);
//   }

//   function onJs(err, js) {
//     if (err) return callback(err);
//     var deps = module.deps = mine(js);
//     module.js = js;
//     parallel(deps.map(function (match) {
//       return repo.pathToEntry(root, "filters/modules/" + match.name + ".js");
//     }), onEntries);
//   }

//   function onEntries(err, entries) {
//     if (err) return callback(err);
//     var deps = module.deps;
//     entries.forEach(function (entry, i) {
//       deps[i].hash = entry.hash;
//     });
//     onDeps();
//   }

//   function onDeps() {
//     console.log(module);
//   }

//   var top = cache[root];
//   var dir = top.filters;
//   if (!dir) return callback(new Error("Missing filters in root: " + root));
//   var tree = cache[dir.hash];
//   if (!tree) {
//     return repo.loadAs("tree", dir.hash, function (err, tree) {
//       if (err) return callback(err);
//       cache[dir.hash] = tree;
//       return handleCommand(req, callback);
//     });
//   }
//   var entry = tree[name + ".js"];
//   if (!entry) {
//     return callback(new Error("No such filter '" + req.name + "' in root: " + root));
//   }
//   var module = modules[name];

//   function onModule() {
//   if (!module) {
//     return repo.loadAs("text", entry.hash, function (err, js) {
//       if (err) return callback(err);
//       modules[name] = {
//         hash: entry.hash,
//         fn: compileModule(js, "git:" + root + ":/filters/" + name + ".js")
//       };
//     return handleCommand(req, callback);
//     });
//   }
//   module.fn(req, callback);
}

// Key is path to module, value is live module exports object
var modules = null;
var lastRoot = null;
function compile(repo, root, path, callback) {
  if (!callback) return compile.bind(this, repo, root, path);

  // Invalidate all the module caches on a change anywhere in the tree.
  if (lastRoot !== root) {
    modules = {};
    lastRoot = root;
  }

  // Check the cache for an already compiled module.
  var module = modules[path];
  if (module) return callback(null, module);

  var deps, js;

  return repo.pathToEntry(root, path, onEntry);

  function onEntry(err, entry) {
    if (!entry) return callback(err);
    return repo.loadAs("text", entry.hash, onJs);
  }

  function onJs(err, result) {
    if (err) return callback(err);
    js = result;
    deps = mine(js);
    if (!deps.length) return onDeps();
    parallel(deps.map(function (dep, i) {
      var depPath = pathJoin(path, "..", dep.name);
      deps[i].path = depPath;
      return compile(repo, root, depPath);
    }), onDeps);
  }

  function onDeps(err) {
    if (err) return callback(err);
    if (deps.length) {
      for (var i = deps.length - 1; i >= 0; i--) {
        var dep = deps[i];
        js = js.substr(0, dep.offset) + dep.path + js.substr(dep.offset + dep.name.length);
      }
    }
    var module = modules[path] = compileModule(js, path);
    callback(null, module);
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
  if (name in modules) return modules[name];
  throw new Error("Invalid require in sandbox: " + name);
}


function rootCheck(repo, callback) {
  // Get the root, but throttle request rate.
  var root;
  var last = Date.now();
  repo.loadAs("commit", "refs/heads/master", onRoot);
  return getRoot;

  function getRoot() {
    var now = Date.now();
    if ((now - last) > 5000) {
      last = now;
      repo.loadAs("commit", "refs/heads/master", onRoot);
    }
    return root;
  }

  function onRoot(err, commit) {
    if (err) console.error(err.stack);
    if (commit) root = commit.tree;
    callback && callback(err);
  }
}
