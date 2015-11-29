var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var cheerio = require('cheerio');

var postToken = process.env.POST_TOKEN || '';
var getToken = process.env.GET_TOKEN || '';
var port = process.env.PORT || 3000;
var maxHits = process.env.MAX_HITS || 1000;
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
    if (!req.body) return res.sendStatus(400);

    var postData = req.body;
    postData.text = clean(postData.text.replace(postData.trigger_word, ''));

    if (postData.token !== postToken) {
        return res.json({
            text: messages.INVALID_TOKEN
        });
    } else if (!postData.text || !postData.text.length) {
        return res.json({
            text: messages.NO_QUERY
        });
    }

    search(postData.text, function ($, panel) {
        res.json({
            text: formatSingle($, panel)
        });
    }, function (matches) {
        res.json({
            text: formatMultiple(matches)
        });
    }, function () {
        res.json({
            text: messages.NO_RESULTS
        });
    }, function () {
        res.sendStatus(500);
    });
});

// GET request returns plain text
app.get('/', function (req, res) {
    var text = req.query.text;
    res.type('text/plain');

    if (req.query.token !== getToken) {
        return res.send(messages.INVALID_TOKEN);
    } else if (!text || !text.length) {
        return res.send(messages.NO_QUERY);
    }

    search(text, function ($, panel) {
        res.write(formatSingle($, panel));
        res.end();
    }, function (matches) {
        res.write(formatMultiple(matches));
        res.end();
    }, function () {
        res.send(messages.NO_RESULTS);
    });
});

app.listen(port);
console.info('Listening on port %s', port);

/**
 * Converts a list of cards as returned by NetrunnerDB into a text list to be returned to slack
 *
 * @param   matches The array of cards matching the query, returned from NRDB
 */
function formatMultiple (matches) {
    var o = '';
    matches = matches.text().split('\n').map(function (s) {
        return clean(s);
    }).filter(function (s) {
        return s.length > 0;
    });
    o += matches.length;
    if (matches.length > maxHits) {
        o += messages.TOO_MANY;
    } else {
        o += messages.MULTIPLE_RESULTS + '\n\n';
        matches.map(function (s) {
            o += '  • ' + s + '\n';
        });
    }
    return o;
}

/**
 * Converts a single card from NetrunnerDB into text to be returned to slack.
 */
function formatSingle ($, panel) {
    var o = '';
    var flavor;
    o += '*' + clean(panel.find('.panel-heading').text()).replace('♦', '◆') + '*\n';
    o += clean(panel.find('.card-info').text()) + '\n';
    panel.find('.card-text p').each(function (i, p) {
        o += '> ' + clean($(p).text()) + '\n';
    });
    flavor = clean(panel.find('.card-flavor').text());
    if (flavor.length) o += '_' + flavor + '_\n';
    o += clean(panel.find('.card-illustrator').text()) + '\n';
    o += panel.find('a.card-title').attr('href');
    return o;
}

/**
 * Clean a string by removing tab characters and trailing whitespace
 *
 * @param String s
 */
function clean (s) {
    return s.replace(/\s\s+/g, ' ').replace('\t', '').trim();
}

/**
 * Substitute icons and strong tags inside NRDB body text
 *
 * @param String body
 */
function substitute (body) {
    body = body.replace(/<span class="icon icon-click"><\/span>/g, ':_click:');
    body = body.replace(/<span class="icon icon-credit"><\/span>/g, ':_credit:');
    body = body.replace(/<span class="icon icon-trash"><\/span>/g, ':_trash:');
    body = body.replace(/<span class="icon icon-link"><\/span>/g, ':_link:');
    body = body.replace(/<span class="icon icon-mu"><\/span>/g, ':_mu:');
    body = body.replace(/<span class="icon icon-1mu"><\/span>/g, ':_1mu:');
    body = body.replace(/<span class="icon icon-2mu"><\/span>/g, ':_2mu:');
    body = body.replace(/<span class="icon icon-3mu"><\/span>/g, ':_3mu:');
    body = body.replace(/<span class="icon icon-recurring-credit"><\/span>/g, ':_recurringcredit:');
    body = body.replace(/<span class="icon icon-subroutine"><\/span>/g, ':_subroutine:');
    body = body.replace(/<strong>/g, '*');
    body = body.replace(/<\/strong>/g, '*');
    body = body.replace(/<sup>/g, '^');
    body = body.replace(/<\/sup>/g, '');
    return body;
}

/**
 * Search NetrunnerDB for the specified string
 *
 * @param String text String to search with
 * @param Function oneResult Callback if one card is found
 * @param Function manyResults Callback if more than one card is found
 * @param Function noResults Callback if no cards are found
 * @param Function error Callback if there was an error
 */
function search (text, oneResult, manyResults, noResults, error) {
    oneResult = oneResult || _noop;
    manyResults = manyResults || _noop;
    noResults = noResults || _noop;
    error = error || _noop;

    // If forceful mode is on, pick any exact match when there are multiples
    var forceful = false;
    if (text.indexOf('!') === 0) {
        forceful = true;
        text = text.substr(1);
    }


    text = text.toLowerCase();
    request('http://netrunnerdb.com/find/?q=' + text, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var $ = cheerio.load(substitute(body));
            var panel = $('.panel');
            var matches = $('[data-th="Title"]');

            if (panel && panel.length === 1) {
                oneResult($, panel);
            } else if (matches.length) {
                var found = false;
                if (forceful) {
                    matches.each(function (i, m) {
                        m = $(m);
                        var re = RegExp('^'+text, 'i');
                        if (!found && clean(m.text()).match(re)) {
                            found = true;
                            request(m.find('a').attr('href'), function (error, response, body) {
                                var $ = cheerio.load(substitute(body));
                                oneResult($, $('.panel'));
                            });
                        }
                    });
                } else {
                    manyResults(matches);
                }
            } else {
                noResults();
            }
        } else {
            error();
        }
    });
}

/**
 * Empty function to use in place of missing callbacks
 */
function _noop () {}
