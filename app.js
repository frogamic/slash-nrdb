var express = require('express');
var bodyParser = require('body-parser');

var nrdb_cards = require('./nrdb-cards.js');

var postToken = process.env.POST_TOKEN || '';
var getToken = process.env.GET_TOKEN || '';
var port = process.env.PORT || 3000;
var messages = {
    INVALID_TOKEN: 'Invalid token detected, deploying ICE\n↳ End the run',
    NO_QUERY: 'I can\'t find nothing, what\'s next? dividing by zero?',
    MULTIPLE_RESULTS: ' cards matched your search:',
    NO_RESULTS: 'You successfully access R&amp;D but it doesn\'t hold what you\'re looking for',
    TOO_MANY: ' results!? you tryna overflow my core buffers?'
};

var app = express();
app.use(bodyParser.urlencoded({extended: true}));

// POST request returns JSON
app.post('/', function (req, res) {
    if (!req.body){
        return res.sendStatus(400);
    }
    var postData = req.body;
    var searches = [];
    var cardFinder = new RegExp('.*?\\[(.*?)\\]', 'g');
    var found;

    // Ensure the request comes from an authorized source
    if (postData.token !== postToken) {
        return res.json({'text': messages.INVALID_TOKEN});
    }
    // Ensure that the request contains a valid query
    if (!postData.text || !postData.text.length) {
        return res.json({'text': messages.NO_QUERY});
    }
    // Detect and remove the trigger word from the text
    if (postData.text.match(/^nrdb:/i)) {
        searches.push(postData.text.replace(/^nrdb:\s/i, ''));
    } else while ((found = cardFinder.exec(postData.text)) !== null) {
        searches.push('!' + found[1]);
    }

    if(searches.length > 0) {
        // Find the card(s)
        nrdb_cards.find(searches, messages, function (cards) {
            console.info(cards);
            var o = {text: '', attachments:[]};
            for (var i = 0; i < cards.length; i++) {
                var a = {};
                var title;
                if (i === 0) {
                    o.text = cards[0].title;
                    a.pretext = '';
                } else {
                    a.pretext = cards[i].title + '\n';
                }

                a.pretext += cards[i].pretext;
                a.text = cards[i].text;
                a.color = cards[i].color;
                a.mrkdwn_in = ['text', 'pretext'];
                o.attachments.push(a);
            }
            res.json(o);
        });
    } else {
        res.sendStatus(200);
    }
});

// GET request returns plain text
app.get('/', function (req, res) {
    var getData = req.query;

    // Ensure the request comes from an authorized source
    if (getData.token !== getToken) {
        return res.send(messages.INVALID_TOKEN);
    }
    // Ensure that the request contains a valid query
    if (!getData.text || !getData.text.length) {
        return res.json(messages.NO_QUERY);
    }

    // Find the card(s)
    nrdb_cards.find([getData.text], messages, function (cards) {
        if (cards[0]) {
            res.type('text/plain');
            // Write out the response as plain text
            if(cards[0].url) {
                res.write('<' + cards[0].url + '|*' + cards[0].title + '*>\n');
            } else {
                res.write('*' + cards[0].title + '*\n');
            }
            if (cards[0].pretext) {
                res.write(cards[0].pretext);
            }
            if (cards[0].text) {
                res.write('\n>' + cards[0].text.replace(/\n/g, '\n>'));
            }
            res.end();
        } else {
            res.sendStatus(500);
        }
    });
});

app.listen(port);
console.info('Listening on port %s', port);

