var twitter = require('ntwitter');
var util = require('util');
var exec = require('child_process').exec;
var fs = require('fs');
var _ = require('underscore')._;
var winston = require('winston');
winston.add(winston.transports.File, {filename: 'logs/tweetlog.log', maxsize:20971520, maxfiles:5, colorize:true});

var argv = require('optimist')
    .usage('Usage: $0 --track=hashtag --db=DBName')
    //.demand(['track', 'db'])
    .default('db', 'tweetlog') //db to store tweets in
    .default('mode', 'stream') // poll or stream. If stream becomes unreliable may fall back to poll during operation
    .default('initializeBackfill', false) //fetch as far back as we can on the search term to start
    .default('dbtype', 'sqlite')
    .default('logtype', 'user')
    .argv;

//example of db = 'hastactweetlog'
//example of track = 'hastac2011,hastac'

var http = require('http');
var url = require('url');
var async = require('async');
var intervalID;
var pollDelay = 30000; //ms delay between requests when in polling mode
var pollCount = 0;
var mode = argv.mode;
var retryStream = false;
var retryStreamAfter = 50;
var waitStartValue = 1000;
var dbinfo = {};

var tweetstore;
if(argv.dbtype == 'sqlite'){
    winston.info('using sqlite tweetstore');
    tweetstore = require('./tweetstore_sqlite.js');
    dbinfo.name = argv.db;
}
else if(argv.dbtype == 'mongodb'){
    winston.info('using mongodb tweetstore');
    tweetstore = require('./tweetstore_mongodb.js');
    dbinfo.name = argv.db;
    dbinfo.address = '127.0.0.1';
    dbinfo.port = 27017;
}
else{
    winston.err("invalid dbtype specified for logging");
    process.exit();
}

//Stored app credentials - application credentials + oauth keys associated with user
var ntwitCredentials = JSON.parse(fs.readFileSync('./config/credentials.json'));
var credentials = {
    "consumer_key": ntwitCredentials.ntwitlog_consumer_key,
    "consumer_secret": ntwitCredentials.ntwitlog_consumer_secret,
    "access_token_key": ntwitCredentials.oauthAccessToken,
    "access_token_secret": ntwitCredentials.oauthAccessTokenSecret
};

winston.info(util.inspect(credentials));
var twit = new twitter(credentials);


var wait = waitStartValue; //wait ms before reconnecting

var pollRest = function(callback){
    winston.info("pollRest");
    winston.info(argv.track);
    twit.search(argv.track, {result_type:'recent', rpp:100, include_entities:'true'}, function(err, data) {
        _.each(data.results, function(val, index){
            tweetstore.storeTweet(val, function(){});
        });
        winston.info(util.inspect(data, false, null, true));
        callback(data);
    });
};

var fetchMore = function(params, callback){
    winston.info("fetchMore");
    winston.info(util.inspect(params));
    twit.getUserTimeline(params, function(err, data){
        if(err){
            winston.info("ERROR FROM getUserTimeline");
            winston.info(err);
            winston.info(data);
            process.exit(1);
        }
        totalRequests++;
        var oldestTweetID = '';
        winston.info('tweets received: ' + data.length);
        winston.info("totalRequests: " + totalRequests);
        //log the tweets
        _.each(data, function(val, index){
            tweetstore.storeTweet(val, function(){});
            winston.log('tweetID: ' + val.id_str);
            if((oldestTweetID === '') || (oldestTweetID.length == val.id_str.length && oldestTweetID > val.id_str) || (parseInt(oldestTweetID, 10) > parseInt(val.id_str, 10)) ){
                oldestTweetID = val.id_str;
                winston.info('oldestTweetID:' + oldestTweetID);
            }
        });
        
        if(data.length > 1 && totalRequests < 8){
            winston.info("more than 1 tweet in results - fetching more");
            params.max_id = oldestTweetID;
            fetchMore(params, function(){
                callback();
            });
        }
        else{
            callback();
        }
    });
};

var pullFullUserTimeline = function(params, callback){
    winston.info("pullFullUserTimeline");
    var totalRequests = 0;
    var rparams = {screen_name:'fcheslack', include_entities:'true', include_rts:'true', exclude_replies:'false', count:200};
    
    fetchMore(rparams, function(){
        winston.info("Done with pullFullUserTimeline requests");
        callback();
    });
};

var fillTimelineFromRest = function(params, callback){
    
};

var fillFromRest = function(callback){
    winston.info('fillFromRest');
    pollCount++;
    if(retryStream && pollCount > retryStreamAfter){
        //reset pollCount and try to stream
        pollCount = 0;
        wait = waitStartValue;
        startListening();
    }
    //get the highest id tweet we have in our store
    tweetstore.fetchRecent(1, function(err, results){
        if(err){
            winston.info("error fetching most recent tweet - exiting");
            cleanexit();
        }
        if(results.length === 0){
            winston.info("have no tweets - fill lots of them");
            //TODO: fill as far back as we can go with REST API instead of just 1 page
            twit.search(argv.track, {result_type:'recent', rpp:100, include_entities:'true', since_id:sinceid}, function(err, data) {
                //log the tweets
                _.each(data.results, function(val, index){
                    tweetstore.storeTweet(val, function(){});
                });
                
                winston.info('filled from rest - ' + data.results.length + ' new tweets');
                //winston.info(util.inspect(data, false, null, true));
                callback(data);
            });
        }
        else{
            winston.info('got most recent tweet');
            var mostRecentTweet = results[0];
            var sinceid = mostRecentTweet.id;
            //winston.info("most recent tweet:");
            //winston.info(util.inspect(mostRecentTweet, false, null, true));
            //wrap in try just in case these fields don't exist
            try{
                if(mostRecentTweet.from_user){
                    winston.info(mostRecentTweet.created_at + ' : ' + mostRecentTweet.from_user + ': ' + mostRecentTweet.text);
                }
                else{
                    winston.info(mostRecentTweet.created_at + ' : ' + mostRecentTweet.user.screen_name + ': ' + mostRecentTweet.text);
                }
            }
            catch(e){
                winston.info("error showing most recent tweet");
                winston.info(util.inspect(mostRecentTweet));
            }
            //search for tweets after our last logged tweet
            twit.search(argv.track, {result_type:'recent', rpp:100, include_entities:'true', since_id:sinceid}, function(err, data) {
                if(err){
                    winston.info("Twitter Search Error:");
                    winston.info(err);
                    callback(err);
                }
                
                //log the tweets
                _.each(data.results, function(val, index){
                    tweetstore.storeTweet(val, function(){});
                });
                if(data.length){
                    winston.info('filled from rest - ' + data.results.length + ' new tweets');
                    winston.info(util.inspect(data.results[0].id_str));
                    winston.info(util.inspect(data.results[0].text));
                    //winston.info(util.inspect(data, false, null, true));
                }
                callback(data);
            });
        }
    });
    
};

var startPolling = function(delay){
    intervalID = setInterval(fillFromRest, delay, function(){});
};

var handleStreamedTweet = function(tweet){
    winston.info("Received streamed tweet");
    //store the tweet
    tweetstore.storeTweet(tweet, function(err){
        if(err){
            winston.err("Error storing tweet");
        }
    });
    //winston.info(util.inspect(tweet, false, null, true));
    try{
        if(tweet.from_user){
            winston.info(tweet.created_at + ' : ' + tweet.from_user + ': ' + tweet.text);
        }
        else{
            winston.info(tweet.created_at + ' : ' + tweet.user.screen_name + ': ' + tweet.text);
        }
    }
    catch(e){
        winston.info("Error showing streamed tweet");
        winston.info(e);
        winston.info(util.inspect(tweet));
    }
};

var handleStreamedMessage = function(msg){
    winston.info("received streamed message");
    if(msg.id_str){
        //an actual tweet, rather than a twitter event
        handleStreamedTweet(msg);
    }
    else{
        //some twitter event
        if(tweetstore.storeEvent){
            tweetstore.storeEvent(msg, function(err){
                if(err){
                    winston.error("Error storing twitter streamed event");
                    winston.error(err);
                }
            });
        }
    }
};

var handleStreamedFriends = function(friends){
    winston.info("received list of friends for user stream");
    //winston.info(util.inspect(friends));
};

var startListening = function(){
    var streamtype;
    var streamargs = {};
    if(argv.logtype == 'user'){
        streamtype = 'user';
    }
    else if(argv.logtype == 'track'){
        streamtype = 'statuses/filter';
    }
    
    if(argv.track){
        streamargs.track = argv.track;
    }
    if(argv.follow){
        streamargs.follow = argv.follow;
    }
    
    twit.stream(streamtype, streamargs, function(stream) {
        winston.info("Listening to streaming - tracking:" + argv.track);
        //cancel any polling interval currently running
        clearInterval(intervalID);
        
        //watch for streaming events
        stream.on('data', function (data) {
            if(data.friends){
                handleStreamedFriends(data.friends);
            }
            else{
                handleStreamedMessage(data);
            }
        });
        
        stream.on('end', function (response) {
            // Handle a disconnection
            winston.info("connection ended - response status: " + response.statusCode);
            winston.info("response: ");
            winston.info(response);
            wait = wait * 2;
            if(wait > 120000){
                winston.info("RECONNECT TIMER HIT 30 SECONDS, NOT RECONNECTING");
                startPolling(pollDelay);
            }
            else{
                setTimeout(startListening, wait);
            }
        });
        stream.on('destroy', function (response) {
            // Handle a 'silent' disconnection from Twitter, no end/error event fired
            winston.info("connection destroyed - response status: " + response.statusCode);
            winston.info("response: ");
            winston.info(response);
            wait = wait * 2;
            if(wait > 120000){
                winston.info("RECONNECT TIMER HIT 30 SECONDS, NOT RECONNECTING");
                //process.exit();
                startPolling(pollDelay);
            }
            else{
                setTimeout(startListening, wait);
            }
        });
        stream.on('limit', function(limit){
            winston.info('limit event received');
            winston.info(limit);
        });
        stream.on('delete', function(tweetDelete){
            winston.info('delete event received');
            winston.info(tweetDelete);
        });
        stream.on('scrub_geo', function(scrubGeo){
            winston.info('scrub_geo event received');
            winston.info(scrubGeo);
        });
        stream.on('error', function(error){
            winston.info("error event received");
            winston.info(util.inspect(error, false, null, true));
            if(error.id && error.text){
                winston.info("NOT AN ERROR, A TWEET");
                tweetstore.storeTweet(error, function(){});
            }
        });
    });
};

var cleanexit = function(){
    tweetstore.closeStore();
};

process.on('uncaughtException', function(err){
    winston.info(err);
});
//startListening();


if(argv.fillUserStream){
    tweetstore.init(dbinfo, {}, function(){
        winston.info("tweetstore initiated, ");
        twit.verifyCredentials(function(err, data){
            if(err){
                winston.info("Error verifying twitter credentials. Have you fetched an oauth token yet?");
                winston.info(err);
                winston.info(data);
                process.exit();
            }
            winston.info("Credentials verified okay");
            winston.info(util.inspect(data));
            winston.info("Pulling full user timeline");
            pullFullUserTimeline({}, function(){
                winston.log("Finished pulling full user timeline");
            });
        });
    });
}
else{
    //winston.info('Tracking ' + argv.track + ' logging into DB ' + argv.db);
    tweetstore.init(dbinfo, {}, function(){
        winston.info("tweetstore initiated, ");
        twit.verifyCredentials(function(err, data){
            if(err){
                winston.info("Error verifying twitter credentials. Have you fetched an oauth token yet?");
                winston.info(err);
                winston.info(data);
                process.exit();
            }
            winston.info("Credentials verified okay");
            winston.info(util.inspect(data));
            
            fillFromRest(function(data){
                if(mode == 'stream'){
                    retryStream = true;
                    startListening();
                }
                else if(mode == 'poll'){
                    startPolling(pollDelay);
                }
            });
        });
    });
}


