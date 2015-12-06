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
    NO_RESULTS: 'You successfully access R&D but it doesn\'t hold what you\'re looking for',
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

    if (postData.token !== postToken) {
        return res.json({'text': messages.INVALID_TOKEN});
    }
    if (!postData.text || !postData.text.length) {
        return res.json({'text': messages.NO_QUERY});
    }

    if (postData.trigger_word){
        postData.text = postData.text.replace(postData.trigger_word + ' ', '');
    }

    nrdb_cards.find(postData.text, messages, function (o) {
        if (o) {
            res.json(o);
        }
        else {
            res.sendStatus(500);
        }
    });
});

// GET request returns plain text
app.get('/', function (req, res) {
    var getData = req.query;

    if (getData.token !== getToken) {
        return res.send(messages.INVALID_TOKEN);
    }
    if (!getData.text || !getData.text.length) {
        return res.json(messages.NO_QUERY);
    }

    nrdb_cards.find(getData.text, messages, function (o) {
        res.type('text/plain');
        if (o) {
            res.write(o.text);
            if (o.attachments) {
                if (o.attachments[0].title)
                    res.write(o.attachments[0].title) + '\n';
                if (o.attachments[0].pretext)
                    res.write(o.attachments[0].pretext) + '\n';
                if (o.attachments[0].text) {
                    res.write('\n>' + o.attachments[0].text.split('\n').join('\n>'));
                }
            }
            res.end();
        } else {
            res.sendStatus(500);
        }
    });
});

app.listen(port);
console.info('Listening on port %s', port);

