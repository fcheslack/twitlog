var sqlite3 = require('sqlite3').verbose();
var util = require('util');
var winston = require('winston');
var _ = require('underscore')._;
//winston.add(winston.transports.File, {filename: 'logs/tweetstore_sqlite.log'});

var db;// = new sqlite3.Database();
var tweets; //tweet log mongo collection

//sqlite statements for our other functions to reuse
var storeTweetStmt, storeEventStmt, fetchTweetStmt, fetchRecentStmt, fetchSinceStmt, fetchOlderStmt, searchTweetsStmt, insertNormalizedStmt;

var rebuildFulltextQuery = "DROP TABLE IF EXISTS tweetsearch; CREATE VIRTUAL TABLE tweetsearch USING fts3(tweetid, tweettext); INSERT INTO tweetsearch (tweetid, tweettext) SELECT tweetid, text FROM tweets;";
var searchQuery =  "SELECT tweets.* FROM tweets JOIN tweetsearch ON tweets.tweetid = tweetsearch.tweetid WHERE tweetsearch.tweettext MATCH ?;";

var init = function(dbp, options, callback){
    //open the sqlite DB specified
    winston.info("Initializing DB: " + dbp.name);
    
    db = new sqlite3.Database(dbp.name, function(err){
        if(err){
            winston.err("Error opening sqlite db");
            winston.err(err);
            callback(err);
        }
        winston.info('initialized sqlite db');
        
        //create database if it doesn't exist yet
        var initDBScript = "CREATE TABLE IF NOT EXISTS tweets (tweetid INTEGER PRIMARY KEY, screen_name, time, text, fulltweet);";
        initDBScript += "CREATE TABLE IF NOT EXISTS normtweets (tweetid INTEGER PRIMARY KEY, screen_name, created_at, text, in_reply_to_user_id, in_reply_to_screen_name, source, in_reply_to_status_id, fulltweet);";
        initDBScript += "CREATE TABLE IF NOT EXISTS tweettimestamps (tweetid INTEGER PRIMARY KEY, timestamp);";
        initDBScript += "CREATE INDEX IF NOT EXISTS tweettimeind ON tweettimestamps (timestamp);";
        initDBScript += "CREATE TABLE IF NOT EXISTS streamevents (eventid INTEGER PRIMARY KEY ASC, eventtype, object);";
        initDBScript += "CREATE TABLE IF NOT EXISTS media (mediaid, tweetid, expanded_url, type, object, UNIQUE (mediaid, tweetid));";
        initDBScript += "CREATE TABLE IF NOT EXISTS user_mentions (userid, tweetid, screen_name, name, object, UNIQUE(userid, tweetid));";
        initDBScript += "CREATE TABLE IF NOT EXISTS urls (expanded_url, tweetid, url, object, UNIQUE (expanded_url, tweetid));";
        initDBScript += "CREATE TABLE IF NOT EXISTS hashtags (text, tweetid, object, UNIQUE (text, tweetid));";
        initDBScript += "DROP TABLE IF EXISTS tweetsearch; CREATE VIRTUAL TABLE tweetsearch USING fts3(tweetid, tweettext); INSERT INTO tweetsearch (tweetid, tweettext) SELECT tweetid, text FROM tweets;";
        
        db.exec(initDBScript, function(err){
            winston.info("initDBScript callback");
            if(err){
                winston.error("Error ensuring DB exists");
                winston.error(err);
                callback(err);
            }
            winston.info("preparing statements");
            //this should be parallelized and not return until all statements are prepared
            //prepare our sqlite statements
            storeTweetStmt = db.prepare("INSERT INTO tweets (tweetid, screen_name, time, text, fulltweet) VALUES (?, ?, ?, ?, ?);", function(err){
                winston.info("storeTweetStmt callback");
                if(err){
                    throw err;
                }
            });
            
            storeTimestampStmt = db.prepare("INSERT INTO tweettimestamps (tweetid, timestamp) VALUES (?, ?);", function(err){
                winston.info("storeTimestampStmt callback");
                if(err){
                    throw err;
                }
            });
            
            storeSearchableTweetStmt = db.prepare("INSERT INTO tweetsearch (tweetid, tweettext) VALUES (?, ?);", function(err){
                winston.info("storeSearchableTweetStmt callback");
                if(err){
                    throw err;
                }
            });
            
            storeEventStmt = db.prepare("INSERT INTO streamevents (eventtype, object) VALUES (?, ?);", function(err){
                winston.info("storeEventStmt callback");
                if(err){
                    throw err;
                }
            });
            
            fetchTweetStmt = db.prepare("SELECT * FROM tweets WHERE tweetid = ?;", function(err){
                winston.info("fetchTweetStmt callback");
                if(err){
                    throw err;
                }
            });
            
            fetchRecentStmt = db.prepare("SELECT * FROM tweets ORDER BY tweetid DESC LIMIT ?;", function(err){
                winston.info("fetchRecentStmt callback");
                if(err){
                    throw err;
                }
            });
            
            fetchSinceStmt = db.prepare("SELECT * FROM tweets WHERE tweetid > ? ORDER BY tweetid DESC;", function(err){
                winston.info("fetchSinceStmt callback");
                if(err){
                    throw err;
                }
            });
            
            fetchOlderStmt = db.prepare("SELECT * FROM tweets WHERE tweetid < ? ORDER BY tweetid DESC LIMIT ?;", function(err){
                winston.info("fetchOlderStmt callback");
                if(err){
                    throw err;
                }
            });
            
            searchTweetsStmt = db.prepare("SELECT tweets.* FROM tweets JOIN tweetsearch ON tweets.tweetid = tweetsearch.tweetid WHERE tweetsearch.tweettext MATCH ? LIMIT 100;", function(err){
                winston.info("searchTweetsStmt callback");
                if(err){
                    throw err;
                }
            });
            
            insertNormalizedStmt = db.prepare("INSERT OR REPLACE INTO normtweets VALUES (?, ?,?,?,?,?,?,?,?);", function(err){
                winston.info("insertNormalizedStmt callback");
                if(err){
                    throw err;
                }
            });
            
            //insert entities statements
            insertMediaStmt = db.prepare("INSERT OR REPLACE INTO media VALUES (?, ?,?,?,?);", function(err){
                winston.info("insertMediaStmt callback");
                if(err){
                    throw err;
                }
            });
            
            insertUserMentionStmt = db.prepare("INSERT OR REPLACE INTO user_mentions VALUES (?, ?,?,?,?);", function(err){
                winston.info("insertUserMentionStmt callback");
                if(err){
                    throw err;
                }
            });
            
            insertUrlStmt = db.prepare("INSERT OR REPLACE INTO urls VALUES (?, ?,?,?);", function(err){
                winston.info("insertUrlStmt callback");
                if(err){
                    throw err;
                }
            });
            
            insertHashtagStmt = db.prepare("INSERT OR REPLACE INTO hashtags VALUES (?, ?,?);", function(err){
                winston.info("insertHashtagStmt callback");
                if(err){
                    throw err;
                }
            });
            
            
            
            winston.info('done calling db.prepares');
            callback(null);
        });
    });
};

var storeMedia = function(tweet, mediaOb, callback){
    winston.info("tweetstore.storeMedia");
    insertMediaStmt.run([mediaOb.id_str, tweet.id_str, mediaOb.expanded_url, mediaOb.type, JSON.stringify(mediaOb)], callback);
};

var storeUserMention = function(tweet, mentionOb, callback){
    winston.info("tweetstore.storeUserMention");
    insertUserMentionStmt.run([mentionOb.id_str, tweet.id_str, mentionOb.screen_name, mentionOb.name, JSON.stringify(mentionOb)], callback);
};

var storeUrl = function(tweet, urlOb, callback){
    winston.info("tweetstore.storeUrl");
    insertUrlStmt.run([urlOb.expanded_url, tweet.id_str, urlOb.url, JSON.stringify(urlOb)], callback);
};

var storeHashtag = function(tweet, hashtagOb, callback){
    winston.info("tweetstore.storeHashtag");
    insertHashtagStmt.run([hashtagOb.text, tweet.id_str, JSON.stringify(hashtagOb)], callback);
};

var storeEntities = function(tweet, callback){
    //store entities if they exist
    if(tweet.entities){
        if(tweet.entities.media){
            _.each(tweet.entities.media, function(val, ind){
                storeMedia(tweet, val);
            });
        }
        if(tweet.entities.user_mentions){
            _.each(tweet.entities.user_mentions, function(val, ind){
                storeUserMention(tweet, val);
            });
        }
        if(tweet.entities.urls){
            _.each(tweet.entities.urls, function(val, ind){
                storeUrl(tweet, val);
            });
        }
        if(tweet.entities.hashtags){
            _.each(tweet.entities.hashtags, function(val, ind){
                storeHashtag(tweet, val);
            });
        }
    }
};

var storeTweet = function(tweet, callback){
    winston.info("tweetstore.storeTweet");
    var screenname = '';
    if(tweet.from_user){
        screenname = tweet.from_user;
    }
    else if(tweet.screen_name){
        screenname = tweet.screen_name;
    }
    else if(tweet.user){
        screenname = tweet.user.screen_name;
    }
    
    var tweetTimestamp = new Date(tweet.created_at);
    
    storeTweetStmt.run([tweet.id_str, screenname, tweet.created_at, tweet.text, JSON.stringify(tweet)], callback);
    storeTimestampStmt.run([tweet.id_str, tweetTimestamp.getTime()], function(){});
    storeSearchableTweetStmt.run([tweet.id_str, tweet.text], function(){});
    
    storeEntities(tweet, function(){});
    
    //tweets.update({id:tweet.id}, tweet, {safe:true, upsert:true}, callback);
};

var storeEvent = function(event, callback){
    winston.info("tweetstore.storeEvent");
    //winston.info(util.inspect(event));
    storeEventStmt.run([event.event, JSON.stringify(event)], callback);
};

var fetchTweet = function(id, callback){
    winston.info("tweetstore.fetchTweet");
    fetchTweetStmt.all([id], function(err, rows){
        if(err){
            callback(err, rows);
        }
        var parsedRows = [];
        for(var i = 0; i < rows.length; i++){
            parsedRows.push(JSON.parse(rows[i].fulltweet));
        }
        callback(err, parsedRows);
    });
    //tweets.find({id:id}).toArray(callback);
};

var fetchRecent = function(limit, callback){
    winston.info("tweetstore.fetchRecent");
    fetchRecentStmt.all([limit], function(err, rows){
        if(err){
            callback(err, rows);
        }
        var parsedRows = [];
        for(var i = 0; i < rows.length; i++){
            parsedRows.push(JSON.parse(rows[i].fulltweet));
        }
        callback(err, parsedRows);
    });
    //tweets.find().sort({id:-1}).limit(limit).toArray(callback);
};

var fetchSince = function(sinceid, callback){
    winston.info("tweetstore.fetchSince - " + sinceid);
    fetchSinceStmt.all([sinceid], function(err, rows){
        if(err){
            callback(err, rows);
        }
        var parsedRows = [];
        for(var i = 0; i < rows.length; i++){
            parsedRows.push(JSON.parse(rows[i].fulltweet));
        }
        callback(err, parsedRows);
    });
    
    //var findparam = {id_str:{$gt:sinceid}};
    //winston.info(util.inspect(findparam));
    //tweets.find(findparam).sort({id:-1}).toArray(callback);
};

var fetchMore = function(oldestid, limit, callback){
    winston.info("tweetstore.fetchMore - " + oldestid);
    fetchOlderStmt.all([oldestid, limit], function(err, rows){
        if(err){
            callback(err, rows);
        }
        var parsedRows = [];
        for(var i = 0; i < rows.length; i++){
            parsedRows.push(JSON.parse(rows[i].fulltweet));
        }
        callback(err, parsedRows);
    });
    
};

var rebuildFTS = function(callback){
    winston.info("rebuildFTS");
    db.exec(rebuildFulltextQuery, function(err, data){
        winston.info("rebuildFulltextQuery returned");
        if(err){
            winston.info("Error rebuilding FTS");
            winston.info(err);
        }
        callback(err, data);
    });
};

var searchTweets = function(q, callback){
    winston.info("tweetstore.searchTweets - " + q);
    searchTweetsStmt.all([q], function(err, rows){
        winston.info('searchTweetsCallback');
        winston.info(util.inspect(rows));
        if(err){
            winston.info("Error searching tweets");
            winston.info(err);
            callback(err, rows);
        }
        var parsedRows = [];
        for(var i = 0; i < rows.length; i++){
            parsedRows.push(JSON.parse(rows[i].fulltweet));
        }
        callback(err, parsedRows);
    });
};

var normalizeTweets = function(){
    db.each("SELECT fulltweet FROM tweets;", function(err, result){
        if(err){
            winston.info("Error normalizing tweet");
        }
        
        var t = JSON.parse(result.fulltweet);
        var td = {
            'tweetid': t.id_str,
            'created_at': t.created_at,
            'screen_name': '',
            'text': t.text,
            'in_reply_to_user_id': t.in_reply_to_user_id,
            'in_reply_to_screen_name': t.in_reply_to_screen_name,
            'source': t.source,
            'in_reply_to_status_id': t.in_reply_to_status_id
        };
        
        if(t.user){
            td.screen_name = t.user.screen_name;
        }
        else{
            td.screen_name = t.from_user;
        }
        var bindings = [td.tweetid, td.screen_name, td.created_at, td.text, td.in_reply_to_user_id, td.in_reply_to_screen_name, td.source, td.in_reply_to_status, result.fulltweet];
        insertNormalizedStmt.run(bindings, function(){
            //inserted normalized
        });
    });
};

var closeStore = function(){
    db.close(function(err){
        if(err){
            winston.err("Error closing sqlite db");
            winston.err(err);
        }
    });
};

var repopulateEntities = function(){
    db.serialize(function(){
        db.all("SELECT fulltweet FROM tweets", function(err, rows) {
            winston.info("BEGINNING MASSIVE ENTITIES TRANSACTION");
            db.run("BEGIN");
            _.each(rows, function(row, ind){
                var tweet = JSON.parse(row.fulltweet);
                storeEntities(tweet, function(){});
            });
            winston.info("COMMITTING MASSIVE ENTITIES TRANSACTION");
            db.run("COMMIT");
        });
    });
};

exports.init = init;
exports.storeTweet = storeTweet;
exports.storeEvent = storeEvent;
exports.fetchTweet = fetchTweet;
exports.fetchRecent = fetchRecent;
exports.fetchSince = fetchSince;
exports.closeStore = closeStore;
exports.rebuildFTS = rebuildFTS;
exports.fetchMore = fetchMore;
exports.searchTweets = searchTweets;
exports.normalizeTweets = normalizeTweets;
exports.storeEntities = storeEntities;
exports.repopulateEntities = repopulateEntities;

