___Install___

>git clone git://github.com/fcheslack/twitlog.git

>cd twitlog

>npm rebuild

__initialize OAuth__
>node ./app.js --initoauth 1

Browse to http://127.0.0.1:8088/sessions/connect


__Prime your log if you care to__
//backfill your home stream (what you get when you log into twitter)
>node ./twitlog.js --backlog true

//backfill a user stream (such as your own)
>node ./twitlog.js --backlog true --username fcheslack

//backfill a search
>node ./twitlog.js --backlog true --search nodejs

//start logging based on logconfig.json settings
>node ./twitlog.js #leave running to log streaming tweets

//half assed front end:
>node ./app.js  #browse to http://127.0.0.1:8088

__config files__
_logconfig.json_
>{
>    "logtype": "user", //user or search
>    "track": ["zotero","thatcamp","fcheslack"], //search terms to track
>    "dbtype": "sqlite", //sqlite or mongodb
>    "db": "./twitlog.db" //name of the database, filename for sqlite or dbname for mongodb
>}

_appconfig.json_
>{
>    "oauth_callback": "http://127.0.0.1:8088/sessions/callback", //where the oauth callback should go to. if you're hosting on your local machine the default is fine
>    "db": "./twitlog.db",
>    "dbtype": "sqlite"
>}


There is also a credentials config file in ./config which holds unsecured oauth tokens, so if this is on a public server access to that file should be restricted. Note though that even if you're using the front end, it is served through a nodejs server so there is no need for this to be run from a web accessible directory.

