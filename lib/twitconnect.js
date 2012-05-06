var twitter = require('ntwitter');
var util = require('util');
var exec = require('child_process').exec;
var fs = require('fs');
var _ = require('underscore')._;
var winston = require('winston');
//winston.add(winston.transports.File, {filename: 'logs/tweetlog.log', maxsize:20971520, maxfiles:5, colorize:true});

var Twitconnect = function(config){
    this.config = _.extend({credentials:{},
                            logtype:'user',
                            track:'',
                            follow:[],
                            intervalID:null,
                            pollDelay: 30000,
                            pollCount: 0,
                            retryStream:false,
                            retryStreamAfter: 50,
                            waitStartValue: 1000,
                            wait:1000,
                            maxTotalLookbackRequests:20
                            }, config);
    
    this.twit = new twitter(this.config.credentials);
};

Twitconnect.prototype.setCredentials = function(oauthCredentials){
    this.config.credentials = oauthCredentials;
    this.twit = new twitter(this.config.credentials);
};

Twitconnect.prototype.pollRest = function(callback){
    winston.info("pollRest");
    winston.info(argv.track);
    this.twit.search(argv.track, {result_type:'recent', rpp:100, include_entities:'true'}, function(err, data) {
        _.each(data.results, function(val, index){
            tweetstore.storeTweet(val, function(err, ret){
                if(err){
                    winston.log("Error storing tweet");
                    winston.log(err);
                }
            });
        });
        winston.info(util.inspect(data, false, null, true));
        callback(data);
    });
};

Twitconnect.prototype.tweetCallback = function(tweet){
    winston.info("Received streamed tweet");
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

/**
 * Default callback on twitter events (limit, delete, scrub_geo)
 * @param  {[type]} event [description]
 * @return {[type]}       [description]
 */
Twitconnect.prototype.teventCallback = function(event){
    
};

Twitconnect.prototype.handleStreamedMessage = function(msg){
    winston.info("received streamed message");
    if(msg.id_str){
        //an actual tweet, rather than a twitter event
        this.tweetCallback(msg);
    }
    else{
        //some twitter event
        this.teventCallback(msg);
    }
};

Twitconnect.prototype.handleStreamedFriends = function(friends){
    winston.info("received list of friends for user stream");
    //winston.info(util.inspect(friends));
};

/**
 * Start listening to the stream, with args based on current config
 * @return {[type]} [description]
 */
Twitconnect.prototype.startListening = function(){
    var streamtype;
    var streamargs = {};
    var tc = this;
    var twit = tc.twit;
    
    if(tc.config.logtype == 'user'){
        streamtype = 'user';
    }
    else if(tc.config.logtype == 'track'){
        streamtype = 'statuses/filter';
    }
    
    if(_.isArray(tc.config.track)){
        streamargs.track = tc.config.track.join(',');
    }
    else{
        streamargs.track = tc.config.track;
    }
    
    if(_.isArray(tc.config.follow)){
        streamargs.follow = tc.config.follow.join(',');
    }
    else{
        streamargs.follow = tc.config.follow;
    }
    if(streamargs.follow === '') delete streamargs.follow; //twitter thinks an empty follow is unacceptable
    
    twit.verifyCredentials(function(err, data){
        if(err){
            winston.info("Error verifying twitter credentials. Have you fetched an oauth token yet?");
            winston.info(err);
            winston.info(data);
            process.exit(1);
        }
        winston.info("Credentials verified okay");
        winston.info(util.inspect(data));
        
        winston.info("about to start streaming");
        winston.info(streamtype);
        winston.info(util.inspect(streamargs));
            
        twit.stream(streamtype, streamargs, function(stream) {
            winston.info("Listening to streaming - tracking:" + streamargs.track);
            //cancel any polling interval currently running
            clearInterval(this.intervalID);
            
            //watch for streaming events
            stream.on('data', function (data) {
                if(data.friends){
                    tc.handleStreamedFriends(data.friends);
                }
                else{
                    tc.handleStreamedMessage(data);
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
            stream.on('error', function(error, statusCode){
                winston.info("error event received");
                winston.info(util.inspect(error, true, null, true));
                winston.info(util.inspect(statusCode));
                if(error.id && error.text){
                    winston.info("NOT AN ERROR, A TWEET");
                    tc.handleStreamedMessage(error);
                }
            });
        });
    });
};

Twitconnect.prototype.fetchMoreRest = function(type, params, cont, callback){
    winston.info("fetchMoreRest");
    winston.info(util.inspect(params));
    winston.info(util.inspect(cont));
    var tc = this;
    var url;
    
    if(!cont){
        cont = {totalRequests:0};
    }
    cont.totalRequests++;
    
    switch(type){
        case "home_timeline":
            url = '/statuses/home_timeline.json';
            break;
        case "user_timeline":
            url = '/statuses/user_timeline.json';
            break;
        case "mentions":
            url = '/statuses/mentions.json';
            break;
        case "retweeted_by_me":
            url = '/statuses/retweeted_by_me.json';
            break;
        case "retweeted_to_me":
            url = '/statuses/retweeted_to_me.json';
            break;
        case "retweets_of_me":
            url = '/statuses/retweets_of_me.json';
            break;
        case "retweeted_to_user":
            url = '/statuses/retweeted_to_user.json';
            break;
        case "retweeted_by_user":
            url = '/statuses/user_timeline.json';
            break;
        
        case "search":
            url = this.twit.options.search_base + '/search.json';
            break;
    }
    
    winston.info("Making twit get request: " + url);
    winston.info(util.inspect(params));
    this.twit.get(url, params, function(err, results){
        var tweets;
        if(err){
            winston.error("ERROR FROM fetchMoreRest");
            winston.info(err);
            winston.info(tweets);
            process.exit(1);
        }
        if(_.isArray(results)){
            tweets = results;
        }
        else if(results.hasOwnProperty('results')){
            tweets = results.results;
        }
        
        var oldestTweetID = '';
        winston.info('tweets received: ' + tweets.length);
        winston.info("totalRequests: " + cont.totalRequests);
        //log the tweets
        _.each(tweets, function(val, index){
            if((oldestTweetID === '') || (oldestTweetID.length == val.id_str.length && oldestTweetID > val.id_str) || (parseInt(oldestTweetID, 10) > parseInt(val.id_str, 10)) ){
                oldestTweetID = val.id_str;
                winston.info('oldestTweetID:' + oldestTweetID);
            }
        });
        
        if(tweets.length > 1 && cont.totalRequests < cont.maxTotalLookbackRequests){
            winston.info("more than 1 tweet in results - fetching more");
            params.max_id = oldestTweetID;
            tc.fetchMoreRest(type, params, cont, function(mtweets){
                var atweets;
                winston.info("got mtweets, concatenating:");
                winston.info(tweets.length);
                winston.info(mtweets.length);
                atweets = tweets.concat(mtweets);
                winston.info(tweets.length);
                callback(atweets);
            });
        }
        else{
            winston.info("not more than 1 tweet in results - returning tweets");
            winston.info(tweets.length);
            callback(tweets);
        }
    });
};


Twitconnect.prototype.pullFullUserTimeline = function(screen_name, params, callback){
    winston.info("pullFullUserTimeline");
    var tc = this;
    var totalRequests = 0;
    var timelineType = 'home_timeline';
    var rparams = _.extend({}, {include_entities:'true', include_rts:'true', exclude_replies:'false', count:200}, params);
    if(screen_name){
        rparams.screen_name = screen_name;
        timelineType = 'user_timeline';
    }
    
    this.fetchMoreRest(timelineType, rparams, {totalRequests:0, maxTotalLookbackRequests:this.config.maxTotalLookbackRequests}, function(tweets){
        winston.info("Done with pullFullUserTimeline requests");
        callback(tweets);
    });
};

Twitconnect.prototype.fillTimelineFromRest = function(screen_name, params, callback){
    winston.info("fillTimelineFromRest");
    var tc = this;
    var totalRequests = 0;
    var timelineType = 'home_timeline';
    var rparams = _.extend({}, {include_entities:'true', include_rts:'true', exclude_replies:'false', count:200}, params);
    if(screen_name){
        rparams.screen_name = screen_name;
        timelineType = 'user_timeline';
    }
    
    this.fetchMoreRest(timelineType, rparams, {totalRequests:0, maxTotalLookbackRequests:this.config.maxTotalLookbackRequests}, function(tweets){
        winston.info("Done with pullFullUserTimeline requests");
        callback(null, tweets);
    });
};

Twitconnect.prototype.fillSearchFromRest = function(search, params, callback){
    winston.info("fillSearchFromRest");
    var tc = this;
    var totalRequests = 0;
    var rparams = _.extend({}, {q:search, include_entities:'true', include_rts:'true', exclude_replies:'false', rpp:100, result_type:'recent'}, params);
    
    this.fetchMoreRest('search', rparams, {totalRequests:0, maxTotalLookbackRequests:this.config.maxTotalLookbackRequests}, function(tweets){
        winston.info("Done with fillSearchFromRest requests");
        callback(null, tweets);
    });
};

Twitconnect.prototype.fillFromRest = function(recentTweetID, callback){
    winston.info('fillFromRest');
    var tc = this;
    pollCount++;
    if(recentTweetID === null){
        //TODO: fill as far back as we can go with REST API instead of just 1 page
        this.twit.search(argv.track, {result_type:'recent', rpp:100, include_entities:'true', since_id:sinceid}, function(err, data) {
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
        var sinceid = recentTweetID;
        var trackarg;
        //search for tweets after our last logged tweet
        if(_.isArray(this.config.track)){
            trackarg = this.config.track.join(',');
        }
        else{
            trackarg = this.config.track;
        }
        
        this.twit.search(trackarg, {result_type:'recent', rpp:100, include_entities:'true', since_id:sinceid}, function(err, data) {
            if(err){
                winston.info("Twitter Search Error:");
                winston.info(err);
            }
            //TODO:go further back if more results and compile results before this callback
            callback(err, data);
        });
    }
};

Twitconnect.prototype.startPolling = function(delay){
    this.intervalID = setInterval(fillFromRest, delay, function(){});
};


exports.Twitconnect = Twitconnect;


