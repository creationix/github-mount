var cache = {};
module.exports = {
  get: function (hash, callback) {
    console.log("CACHE GET", hash);
    callback(null, cache[hash]);
  },
  set: function (hash, value, callback) {
    console.log("CACHE SET", hash);
    cache[hash] = value;
    callback();
  }
};
