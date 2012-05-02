var express = require('express');
var sys = require('util');
var fs = require('fs');
var oauth = require('oauth');
var _ = require('underscore')._;
var winston = require('winston');
winston.add(winston.transports.File, {filename: 'logs/app.log'});

var util = require('util');
var recentTweets = [];

var argv = require('optimist')
    .usage('Usage: $0 --credfile="./config/credentials.json"')
    //.demand(['track', 'db'])
    .default('credfile', './config/credentials.json') //db to store tweets in
    .default('conffile', './config/appconfig.json') //db to store tweets in
    .default('db', 'tweetlog') //db to store tweets in
    .default('dbtype', 'sqlite')
    .argv;
    
var app = express.createServer();
var io = require('socket.io').listen(app);

var credentials = JSON.parse(fs.readFileSync(argv.credfile));
var appconfig = JSON.parse(fs.readFileSync(argv.conffile) );
var conf = _.extend({}, appconfig, argv);
winston.info(util.inspect(conf));

var _twitterConsumerKey = credentials.ntwitlog_consumer_key;// process.env['TWITTER_CONSUMER_KEY'];
var _twitterConsumerSecret = credentials.ntwitlog_consumer_secret;// process.env['TWITTER_CONSUMER_SECRET'];
var oauthcallback = appconfig.oauth_callback;

var dbinfo = {};
var tweetstore;

function consumer() {
  return new oauth.OAuth(
    "https://twitter.com/oauth/request_token",
    "https://twitter.com/oauth/access_token",
    _twitterConsumerKey,
    _twitterConsumerSecret,
    "1.0A",
    oauthcallback,
    "HMAC-SHA1");
}

app.configure('development', function(){
  app.use(app.router);
  app.use(express.static(__dirname + '/static'));
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.use(express.logger());
  app.use(express.cookieParser());
  app.use(express.bodyParser());
  app.use(express.session({
    secret: "secretkey"
  }));
});

app.dynamicHelpers({
  session: function(req, res){
    return req.session;
  }
});

app.set("view engine", "html");
app.register(".html", require("jqtpl").express);
app.register(".css", require("jqtpl").express);
//app.register('.html', require('jade'));

//app.get('/', function(req, res){
  //res.render('index.html', {layout:false});
  //res.render('index.jade', {layout:false});
  //res.send('Hello World');
//});

/*
app.get('/style.css', function(req, res){
  res.render('style.css', {layout:false});
});
*/
if(argv.initoauth){
  app.get('/sessions/connect', function(req, res){
    consumer().getOAuthRequestToken(function(error, oauthToken, oauthTokenSecret, results){
      if (error) {
        res.send("Error getting OAuth request token : " + sys.inspect(error), 500);
      } else {
        req.session.oauthRequestToken = oauthToken;
        req.session.oauthRequestTokenSecret = oauthTokenSecret;
        sys.puts(">>"+req.session.oauthRequestToken);
        sys.puts(">>"+req.session.oauthRequestTokenSecret);
        
        res.redirect("https://twitter.com/oauth/authorize?oauth_token="+req.session.oauthRequestToken);
      }
    });
  });

  app.get('/sessions/callback', function(req, res){
    sys.puts(">>"+req.session.oauthRequestToken);
    sys.puts(">>"+req.session.oauthRequestTokenSecret);
    sys.puts(">>"+req.query.oauth_verifier);
    consumer().getOAuthAccessToken(req.session.oauthRequestToken, req.session.oauthRequestTokenSecret, req.query.oauth_verifier, function(error, oauthAccessToken, oauthAccessTokenSecret, results) {
      if (error) {
        res.send("Error getting OAuth access token : " + sys.inspect(error) + "["+oauthAccessToken+"]"+ "["+oauthAccessTokenSecret+"]"+ "["+sys.inspect(results)+"]", 500);
      } else {
        req.session.oauthAccessToken = oauthAccessToken;
        req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;
        // Right here is where we would write out some nice user stuff
        consumer().get("http://twitter.com/account/verify_credentials.json", req.session.oauthAccessToken, req.session.oauthAccessTokenSecret, function (error, data, response) {
          if (error) {
            res.send("Error getting twitter screen name : " + sys.inspect(error), 500);
          } else {
            console.log("data is %j", data);
            data = JSON.parse(data);
            req.session.twitterScreenName = data.screen_name;
            res.send('You are signed in: ' + req.session.twitterScreenName);
            
            credentials.oauthAccessToken = req.session.oauthAccessToken;
            credentials.oauthAccessTokenSecret = req.session.oauthAccessTokenSecret;
            fs.writeFileSync(argv.credfile, JSON.stringify(credentials) );
          }
        });
      }
    });
  });
}

app.get('/tweets/recent', function(req, res){
  
});

app.get('/tweets/search', function(req, res){
  //winston.info(util.inspect(req.params));
  //winston.info(util.inspect(req.query));
  tweetstore.searchTweets(req.param('q', ''), function(err, tweets){
    var r = {tweets:tweets};
    res.end(JSON.stringify(r));
    //socket.emit('olderTweets', r);
  });
});



app.listen(parseInt(process.env.PORT || 8088, 10));








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

//initialize tweetstore
tweetstore.init({name:argv.db}, {}, function(){
    tweetstore.rebuildFTS(function(){});
    //load most recent tweets
    /*
    tweetstore.fetchRecent(30, function(err, tweets){
        winston.info('tweetstore.fetchRecent callback');
        recentTweets = tweets;
    });
    */
});

io.sockets.on('connection', function (socket) {
    tweetstore.fetchRecent(30, function(err, tweets){
        winston.info('tweetstore.fetchRecent callback');
        //winston.info(util.inspect(tweets));
        socket.emit('initialTweets', { tweets: tweets });
    });
    
    socket.on('moreTweets', function (data) {
        //TODO: send more tweets from earlier than the client has
        if(data.oldestTweetID){
          tweetstore.fetchMore(data.oldestTweetID, 30, function(err, tweets){
            socket.emit('olderTweets', {tweets:tweets});
          });
        }
    });
});

//set timeout to get new tweets.
//this should be done with an event from the logger process
//but for now we'll just check with mongo every few seconds
var updateRecentTweets = function(){
    winston.info('updateRecentTweets');
    if(recentTweets.length > 0){
        winston.info('recent tweets > 0 - fetching since last one');
        tweetstore.fetchSince(recentTweets[0].id_str, function(err, data){
            winston.info(util.inspect(data));
            if(data.length > 0){
                winston.info("new tweets received in servetweets");
                winston.info(data);
                //send tweet to clients
                io.sockets.emit('newTweets', {tweets:data});
                for(var i = data.length - 1; i >= 0; i--){
                    recentTweets.unshift(data[i]);
                }
                if(recentTweets.length > 50){
                    recentTweets = recentTweets.slice(0, 35);
                }
            }
            else{
                winston.info("no new tweets found");
            }
        });
    }
};

var intervalID = setInterval(updateRecentTweets, 30000);

