var fs = require('fs');
var _ = require('underscore')._;
var winston = require('winston');
var util = require('util');
var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('twitlog.db');
var alltweets;
db.all("SELECT * FROM tweets;", function(err, results){alltweets = results;});


