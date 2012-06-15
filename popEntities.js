var util = require('util');
var fs = require('fs');
var _ = require('underscore')._;
var winston = require('winston');

var argv = require('optimist')
    .usage('Usage: $0 --track=hashtag --db=DBName')
    .demand('db')
    .argv;


var dbinfo = {};
var tweetstore;
winston.info('using sqlite tweetstore');
tweetstore = require('./tweetstore_sqlite.js');
dbinfo.name = argv.db;

tweetstore.init(dbinfo, {}, function(){
    tweetstore.repopulateEntities();
});

