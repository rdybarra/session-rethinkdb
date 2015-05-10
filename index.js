var r = require('rethinkdb');
var debug = require('debug')('session:rethinkdb');

module.exports = function (connect) {

  var Store = (connect.session) ? connect.session.Store : connect.Store;

  function RethinkStore(options) {
    var self = this;

    options = options || {};
    options.clientOptions = options.clientOptions || {};
    Store.call(self, options); // Inherit from Store

    self.browserSessionsMaxAge = options.browserSessionsMaxAge || 86400000; // 1 day
    self.table = options.table || 'session';
    
    r.connect(options.clientOptions, function (err, conn) {
      self.conn = conn;
      self.emit('connect');

      r.table('session').indexStatus('expires').run(conn)
      .catch(function (err) {
        return r.table(self.table).indexCreate('expires').run(conn);
      });

      self.clearInterval = setInterval(function () {
        var now = Date.now();
        r.table(self.table)
        .between(0, now, {index: 'expires'})
        .delete()
        .run(self.conn)
        .tap(function (result) {
          debug('DELETED EXPIRED %j', result);
        }).unref();
      }, options.flushOldSessIntvl || 60000);
    });
  }

  RethinkStore.prototype = new Store();

  RethinkStore.prototype.get = function (sid, fn) {
    var self = this;
    r.table(self.table)
    .get(sid)
    .run(self.conn)
    .tap(function (data) {
      debug('GOT %j', data);
      data = data ? JSON.parse(data.session) : null;
      fn(null, data);
    })
    .catch(function (err) {
      fn(err);
      throw err;
    });
  };

  RethinkStore.prototype.set = function (sid, sess, fn) {
    var self = this;

    var sessionToStore = {
      id: sid,
      expires: Date.now() + (sess.cookie.originalMaxAge || self.browserSessionsMaxAge),
      session: JSON.stringify(sess)
    };
    r.table(self.table)
    .insert(sessionToStore, {
      conflict: 'update'
    })
    .run(self.conn, fn);
  }

  RethinkStore.prototype.destroy = function (sid, fn) {
    var self = this;
    return r.table(self.table)
    .get(sid)
    .delete()
    .run(self.conn, fn);
  }

  return RethinkStore;
};
