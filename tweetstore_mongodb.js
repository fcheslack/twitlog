var mongodb = require('mongodb');
var util = require('util');
var winston = require('winston');
winston.add(winston.transports.File, {filename: 'logs/tweetstore_mongodb.log'});

var mongoClient;
var tweets; //tweet log mongo collection

var init = function(db, options, callback){
    
    mongoClient = new mongodb.Db(db.name, new mongodb.Server(db.address, db.port, options));
    mongoClient.open(function(err, client){
        if(err){
            winston.info("Error opening DB connection");
            winston.info(err);
        }
        tweets = new mongodb.Collection(client, 'tweets');
        tweets.ensureIndex({id:1}, {unique:true}, function(err, ind){
            if(err){
                winston.info("error ensuring index on id");
                callback(err);
            }
            tweets.ensureIndex({id_str:1}, {unique:true}, function(err, ind){
                if(err){
                    winston.info("error ensuring index on id_str");
                    callback(err);
                }
                callback();
            });
        });
    });
};

var storeTweet = function(tweet, callback){
    tweets.update({id:tweet.id}, tweet, {safe:true, upsert:true}, callback);
};

var fetchTweet = function(id, callback){
    tweets.find({id:id}).toArray(callback);
};

var fetchRecent = function(limit, callback){
    winston.info("tweetstore.fetchRecent");
    tweets.find().sort({id:-1}).limit(limit).toArray(callback);
};

var fetchSince = function(sinceid, callback){
    winston.info("tweetstore.fetchSince");
    winston.info(sinceid);
    var findparam = {id_str:{$gt:sinceid}};
    winston.info(util.inspect(findparam));
    tweets.find(findparam).sort({id:-1}).toArray(callback);
};

var closeStore = function(){
    mongoClient.close();
};

exports.init = init;
exports.storeTweet = storeTweet;
exports.fetchTweet = fetchTweet;
exports.fetchRecent = fetchRecent;
exports.fetchSince = fetchSince;
exports.closeStore = closeStore;
