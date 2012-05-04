var _ = require('underscore')._;
var argv = require('optimist')
    .usage('Usage: $0 --mdb dname --sdb dbname')
    .demand('mdb')
    .demand('sdb')
    .argv;

var mtweetstore = require('./tweetstore_mongodb.js');
var stweetstore = require('./tweetstore_sqlite.js');

mtweetstore.init({name:argv.mdb, address:'127.0.0.1', port:27017}, {}, function(){
    stweetstore.init({name:argv.sdb}, {}, function(){
        mtweetstore.fetchRecent(5000, function(err, tweets){
            _.each(tweets, function(val, ind){
                stweetstore.storeTweet(val);
            });
        });
    });
});

