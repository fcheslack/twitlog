var sqlite3 = require('sqlite3').verbose();
var util = require('util');
var winston = require('winston');
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
        initDBScript += "CREATE INDEX IF NOT EXISTS tweettimeind ON tweets (time);";
        initDBScript += "CREATE TABLE IF NOT EXISTS streamevents (eventid INTEGER PRIMARY KEY ASC, eventtype, object);";
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
            
            winston.info('done calling db.prepares');
            callback(null);
        });
    });
};


var storeTweet = function(tweet, callback){
    winston.info("tweetstore.storeTweet");
    var screenname = '';
    if(tweet.from_user){
        screenname = tweet.from_user;
    }
    else if(tweet.user){
        screenname = tweet.user.screen_name;
    }
    
    storeTweetStmt.run([tweet.id_str, screenname, tweet.created_at, tweet.text, JSON.stringify(tweet)], callback);
    storeSearchableTweetStmt.run([tweet.id_str, tweet.text], function(){});
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

