var util = require('util');
var fs = require('fs');
var _ = require('underscore')._;
var winston = require('winston');
var Twitconnect = require('./lib/twitconnect.js').Twitconnect;

winston.add(winston.transports.File, {filename: 'logs/tweetlog.log', maxsize:20971520, maxfiles:5, colorize:true});

var argv = require('optimist')
    .usage('Usage: $0 --track=hashtag --db=DBName')
    //.demand(['track', 'db'])
//    .default('db', 'tweetlog') //db to store tweets in
    .default('mode', 'stream') // poll or stream. If stream becomes unreliable may fall back to poll during operation
    .default('initializeBackfill', false) //fetch as far back as we can on the search term to start
//    .default('dbtype', 'sqlite')
//    .default('logtype', 'user')
    .argv;

//example of db = 'hastactweetlog'
//example of track = 'hastac2011,hastac'

var dbinfo = {};
var logconfig = JSON.parse(fs.readFileSync('./config/logconfig.json', 'utf8'));

argv = _.extend({}, logconfig, argv);

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
    winston.error("invalid dbtype specified for logging");
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

winston.verbose(util.inspect(credentials));

var twitterConfig = _.extend({}, {credentials:credentials}, argv);
var tc = new Twitconnect(twitterConfig);

tc.tweetCallback = function(tweet){
    winston.verbose("Received streamed tweet");
    //store the tweet
    tweetstore.storeTweet(tweet, function(err){
        if(err){
            winston.error("Error storing tweet");
            winston.error(err);
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
        winston.error("Error showing streamed tweet");
        winston.error(e);
        winston.error(util.inspect(tweet));
    }
};


var cleanexit = function(){
    tweetstore.closeStore();
};

/*process.on('uncaughtException', function(err){
    winston.info(err);
});
*/
//startListening();


if(argv.fillUserStream){
    winston.info("FILLING USER STREAM");
    tweetstore.init(dbinfo, {}, function(){
        winston.verbose("tweetstore initiated");
        tc.twit.verifyCredentials(function(err, data){
            if(err){
                winston.error("Error verifying twitter credentials. Have you fetched an oauth token yet?");
                winston.error(err);
                winston.verbose(data);
                process.exit();
            }
            winston.info("Credentials verified okay");
            winston.verbose(util.inspect(data));
            winston.info("Pulling full user timeline");
            var screen_name = '';
            if(argv.screen_name) screen_name = argv.screen_name;
            tc.pullFullUserTimeline(screen_name, {}, function(err, tweets){
                _.each(tweets, function(tweet, ind){
                    tc.tweetCallback(tweet);
                });
                winston.info("Finished pulling full user timeline");
            });
        });
    });
}
else if(argv.backlog){
    winston.info("FILLING BACKLOG");
    tweetstore.init(dbinfo, {}, function(){
        winston.verbose("tweetstore initiated");
        if(argv.username){
            tc.fillTimelineFromRest(argv.username, {}, function(err, tweets){
                _.each(tweets, function(tweet, ind){
                    tc.tweetCallback(tweet);
                });
                winston.info("Done filling user timeline backlog");
            });
        }
        else if(argv.search){
            tc.fillSearchFromRest(argv.search, {}, function(err, tweets){
                _.each(tweets, function(tweet, ind){
                    tc.tweetCallback(tweet);
                });
                winston.info("Done filling search backlog");
            });
        }
        else {
            tc.fillTimelineFromRest(null, {}, function(err, tweets){
                _.each(tweets, function(tweet, ind){
                    tc.tweetCallback(tweet);
                });
                winston.info("Done filling home timeline backlog");
            });
        }
    });
}
else{
    winston.info("Filling userstream after the most recent tweet, then streaming tweets");
    //winston.info('Tracking ' + argv.track + ' logging into DB ' + argv.db);
    tweetstore.init(dbinfo, {}, function(){
        winston.verbose("tweetstore initiated, ");
        //backfill log of tweets in home timeline after the most reent tweet we have record of
        tweetstore.fetchRecent(1, function(err, tweets){
            if(err){
                winston.error("Error finding most recent tweet from storage");
            }
            
            var recentTweet;
            if(argv.logtype === 'user'){
                if(tweets.length){
                    recentTweet = tweets[0];
                    tc.fillTimelineFromRest(null, {since_id: recentTweet.id_str}, function(err, tweets){
                        _.each(tweets, function(tweet, ind){
                            tc.tweetCallback(tweet);
                        });
                        winston.info("Done filling user timeline backlog");
                        //Fill tracking backlog
                        _.each(argv.track, function(val, ind){
                            tc.fillSearchFromRest(val, {since_id: recentTweet.id_str}, function(err, tweets){
                                _.each(tweets, function(tweet, ind){
                                    tc.tweetCallback(tweet);
                                });
                            });
                        });
                    });
                }
            }
            else if(argv.logtype === 'track' || argv.logtype === 'search'){
                if(tweets.length){
                    recentTweet = tweets[0];
                    _.each(argv.track, function(val, ind){
                        tc.fillSearchFromRest(val, {since_id: recentTweet.id_str}, function(err, tweets){
                            _.each(tweets, function(tweet, ind){
                                tc.tweetCallback(tweet);
                            });
                        });
                    });
                }
            }
            //start streaming
            tc.startListening();
        });
    });
}



