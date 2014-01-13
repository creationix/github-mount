var accessToken = process.env.TOKEN;
var jsGithub = require('js-github');
var vm = require('vm');
var handleRequest = require('git-publish-http');
var gitPublisher = require('git-publisher');
var http = require('http');

var repos = {};

var server = http.createServer(onRequest);
server.listen(process.env.PORT || 8000, function () {
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
    gitPublisher(repo, compileModule);

    repo.getRoot = rootCheck(repo);
  }

  // Log requests
  var end = res.end;
  res.end = function () {
    console.log(req.method, req.url, res.statusCode);
    return end.apply(this, arguments);
  };

  handleRequest(repo, repo.getRoot(), req, res);
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
  if (name === "sha1") return require('js-git/lib/sha1.js');
  if (name === "parallel") return require('js-git/lib/parallel.js');
  if (name === "path-join") return require('js-linker/pathjoin.js');
  if (name === "mine") return require('js-linker/mine.js');
  throw new Error("Invalid require in sandbox: " + name);
}


function rootCheck(repo) {
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
  }
}
