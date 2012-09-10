#!/usr/bin/python

import json
import argparse
import logging
import sqlite3

logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

parser = argparse.ArgumentParser(description="insert entities from pre-logged tweets")
parser.add_argument('dbpath')
args = parser.parse_args()
print(args)

con = sqlite3.connect(args.dbpath)

alltweets = []
mediaEntities = []
userMentions = []
urls = []
hashtags = []

for row in con.execute("SELECT fulltweet FROM tweets;"):
    ptweet = json.loads(row[0])
    alltweets.append(ptweet)
    if 'entities' in ptweet:
        if 'media' in ptweet['entities']:
            for mediaOb in ptweet['entities']['media']:
                mediaEntities.append((mediaOb['id_str'], ptweet['id_str'], mediaOb['expanded_url'], mediaOb['type'], json.dumps(mediaOb)))
        if 'user_mentions' in ptweet['entities']:
            for mentionOb in ptweet['entities']['user_mentions']:
                userMentions.append((mentionOb['id_str'], ptweet['id_str'], mentionOb['screen_name'], mentionOb['name'], json.dumps(mentionOb)))
        if 'urls' in ptweet['entities']:
            for urlOb in ptweet['entities']['urls']:
                urls.append((urlOb['expanded_url'], ptweet['id_str'], urlOb['url'], json.dumps(urlOb)))
        if 'hashtags' in ptweet['entities']:
            for hashtagOb in ptweet['entities']['hashtags']:
                hashtags.append((hashtagOb['text'], ptweet['id_str'], json.dumps(hashtagOb)))

#con.executemany("INSERT OR REPLACE INTO media VALUES (?, ?,?,?,?);", mediaEntities)
#con.executemany("INSERT OR REPLACE INTO user_mentions VALUES (?, ?,?,?,?);", userMentions)
#con.executemany("INSERT OR REPLACE INTO urls VALUES (?, ?,?,?);", urls)
#con.executemany("INSERT OR REPLACE INTO hashtags VALUES (?, ?,?);", hashtags)

#con.commit()
