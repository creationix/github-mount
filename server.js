var accessToken = process.env.TOKEN;
var jsGithub = require('js-github');
var handleRequest = require('git-publish-http');
var gitPublisher = require('git-publisher');
var http = require('http');
// var hashCache = require('./memcache.js');
var addCache = require('./addcache.js');
var compiler = require('./compiler.js');
var rootCheck = require('./rootcheck.js');
var pathJoin = require('path').join;

var hashCache;
require('./levelcache.js')(pathJoin(__dirname , "cache.db"), function (err, result) {
  if (err) throw err;
  hashCache = result;
});

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


