var argv = require('optimist')
    .usage('Usage: $0 --db DBName')
    .demand('db')
    .argv;


var tweetstore = require('./tweetstore_sqlite.js');
tweetstore.init({name:argv.db}, {}, function(){
    tweetstore.normalizeTweets();
});
