/**
 * Provides a method to find card(s) from NetrunnerDB.
 * @module nrdb-cards
 * @author Dominic Shelton, Kriss Watt
 * @date 6-12-2015
 */
var request = require('request');
var cheerio = require('cheerio');

// The maximum number of card to list when multiple cards are found
var maxHits = process.env.MAX_HITS || 200;
// Faction colours for slack indents
var colours = require('./colours.json');
// A list of common card shorthands and their corresponding full names
var shorthands = require('./shorthands.json');
// Regex generated from the shorthand keys to be used in find/replace
// Only matches whole words
var shorthandRegExp = new RegExp(
        Object.keys(shorthands).reduce(function (pv, cv, ci, a) {
    var o = pv;
    if (ci !== 0) {
        o += '\\b|\\b';
    }
    o += cv;
    if(ci == a.length-1) {
        o+='\\b';
    }
    return o;
}, '\\b'));

/**
 * Finds one or more cards matching `text` from NetrunnerDB, and calls back
 * `responder` with an object representing the results.
 * @param {array}    text      The text to search for
 * @param {Object}   messages  An object containing messages for responses
 * @param {Function} responder A method that will be called with the response after searching
 */
exports.find = function (text, messages, responder) {
    search(text, function ($, panel) {
        responder(parseSingle($, panel, messages));
    }, function ($, matches) {
        responder(parseMultiple($, matches, messages));
    }, function () {
        responder({'text': messages.NO_RESULTS});
    }, function () {
        responder(null);
    });
}

/**
 * Parses a multi-card search result from NetrunnerDB, converting it into an object to be returned
 * to Slack.
 *
 * @param {Object} $         The cheerio object loaded from the NetrunnerDB search result
 * @param {Object} matches   The array of HTML elements containing the titles of cards found
 * @param {Object} messages  An object containing messages for responses
 * @returns {Object} an object matching the Slack API requirement for text with attachments.
 */
function parseMultiple ($, matches, messages) {
    var o = {'text':'', 'attachments':[{text:''}]};
    var hits = matches.length;

    if (hits > maxHits) {
        return {'text': hits + messages.TOO_MANY};
    }

    o.text = hits + messages.MULTIPLE_RESULTS;
    matches.each(function (i, e) {
        e = $(e);
        var text = clean(e.text());
        var url = e.find('a').attr('href');
        o.attachments[0].text += '• <' + url + '|' + text + '>\n'; 
    });
    o.attachments[0].fallback = 'NRDB results for multiple cards';

    return o;
}

/**
 * Parse a single card result from NetrunnerDB, converting it into an object to be returned to
 * Slack
 * @param {Object} $     The cheerio object loaded from the NetrunnerDB search result
 * @param {Object} panel The HTML panel element containing the card information from NetrunnerDB
 * @returns {Object} An object matching the Slack API requirement for text with attachments.
 */
function parseSingle ($, panel) {
    var o = {'text':'', 'attachments':[{pretext:''}]};
    // Replace the regular diamond since Slack converts this to an emoji
    var title = clean(panel.find('.panel-heading').text()).replace('♦', '◆');
    // Get the first word from the text containing the faction
    var faction = clean(panel.find('.card-illustrator').text()).replace(/ .*/, '');
    var info = clean(panel.find('.card-info').text());

    o.text = '<' + panel.find('a.card-title').attr('href');
    o.text +=  '|*' + title + '*>\n';
    o.attachments[0].pretext = formatCardInfo(info, faction);
    panel.find('.card-text p').each(function (i, p) {
        var text = clean($(p).text());
        if (text.replace(/\s/, '').length) {
            if (!o.attachments[0].text) {
                o.attachments[0].text = '';
            }
            o.attachments[0].text += text + '\n';
        }
    });
    o.attachments[0].fallback = 'NRDB results for ' + title;
    o.attachments[0].mrkdwn_in = ['pretext', 'text'];
    o.attachments[0].color = colours[faction];
    return o;
}

/**
 * Format the card info for better display on slack
 * @param {string} info      The card info as displayed on NetrunnerDB
 * @param {string} faction   The card's faction
 * @returns {string} The newly formatted card info string
 */
function formatCardInfo(info, faction) {
    // Remove the bullets as separators
    info = info.split(/ • /);
    // Append the faction emoji after (sub)types
    info[0] += ' - :_' + faction.toLowerCase() + ':';
    // Influence is handled differently for Agendas and Identities
    if (!info[0].match(/(Agenda|Identity)/)) {
        // Remove the influence and get its numerical value
        var influence = parseInt(info.pop().replace(/(?:.|\s)*Influence: (\d+).*/, '$1'));
        // Add bullets after the faction symbol to show influence
        for (var i = 0; i < influence; i++) {
            info[0] += '•';
        }
    }
    // Rejoin info text with newline after type/faction
    info = info[0] + '\n' + info.slice(1).join(' - ');
    // Bolden the primary type
    info = info.replace(/^(.*?)(\n|:)/, '*$1*$2');
    // Replace most stat names with emoji
    info = info.replace(/Memory: (\d)/, ':_$1mu:');
    info = info.replace(/Strength: (\d+)/, '$1 Str');
    info = info.replace(/(?:Install|Cost): (\d+)/, '$1:_credit:');
    info = info.replace(/Rez: (\d+)/, '$1:_rez:');
    info = info.replace(/Adv: (\d+)/, '$1 Adv');
    info = info.replace(/Score: (\d+)/, '$1:_agenda:');
    info = info.replace(/Trash: (\d+)/, '$1:_trash:');
    info = info.replace(/Link: (\d+)/, '$1:_link:');
    info = info.replace(/Deck: (\d+) - Influence: (\d+)/, '$1/$2');
    return info;
}

/**
 * Clean a string by removing tab characters and trailing whitespace
 *
 * @param {string} s
 * @returns {string}
 */
function clean (s) {
    return s.replace(/\s\s+/g, ' ').replace('\t', '').trim();
}

/**
 * Substitute icons and strong tags inside card body text
 *
 * @param {string}  body
 * @returns {string}
 */
function substitute (body) {
    body = body.replace(/<span class="icon icon-click"><\/span>/g, ':_click:');
    body = body.replace(/<span class="icon icon-credit"><\/span>/g, ':_credit:');
    body = body.replace(/<span class="icon icon-trash"><\/span>/g, ':_trash:');
    body = body.replace(/<span class="icon icon-link"><\/span>/g, ':_link:');
    body = body.replace(/([1-3])<span class="icon icon-mu"><\/span>/g, ':_$1mu:');
    body = body.replace(/<span class="icon icon-mu"><\/span>/g, ':_mu:');
    body = body.replace(/<span class="icon icon-([1-3])mu"><\/span>/g, ':_$1mu:');
    body = body.replace(/<span class="icon icon-recurring-credit"><\/span>/g, ':_recurringcredit:');
    body = body.replace(/<span class="icon icon-subroutine"><\/span>/g, ':_subroutine:');
    body = body.replace(/<\/?strong>/g, '*');
    body = body.replace(/<sup>(?:\d+|X)<\/sup>/g, function(x){
        x = x.replace(/<sup>|<\/sup>/g, '');
        x = x.replace('X','ˣ');
        x = x.replace(/\d/,function(d){
            return ['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹'][parseInt(d)];
        });
        return x;
    });
    return body;
}

/**
 * Search NetrunnerDB for the specified string
 *
 * @param {string}   text string to search with
 * @param {Function} oneResult Callback if one card is found
 * @param {Function} manyResults Callback if more than one card is found
 * @param {Function} noResults Callback if no cards are found
 * @param {Function} errorResult Callback if there was an error
 */
function search (text, oneResult, manyResults, noResults, errorResult) {
    oneResult = oneResult || _noop;
    manyResults = manyResults || _noop;
    noResults = noResults || _noop;
    errorResult = errorResult || _noop;

    // If forceful mode is on, pick any exact match when there are multiples
    var forceful = false;
    if (text.indexOf('!') === 0) {
        forceful = true;
        text = text.substr(1);
    }

    // Replace any shorthands in the search text with full names
    text = text.toLowerCase().replace(shorthandRegExp, function(sh){
        return shorthands[sh];
    });

    request('http://netrunnerdb.com/find/?q=' + text, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            return errorResult();
        }
        var $ = cheerio.load(substitute(body));
        // Attempt to find the single card info panel on the page
        var panel = $('.panel');
        // Attempt to find the multiple card titles on the page
        var matches = $('[data-th="Title"]');

        if (panel && panel.length === 1) {
            oneResult($, panel);
        } else if (matches.length) {
            var found = false;
            if (forceful) {
                // Search through the matches for a card that starts with the exact search string
                matches.each(function (i, m) {
                    if (found) {
                        return;
                    }
                    m = $(m);
                    var re = new RegExp('^'+text, 'i');
                    if (clean(m.text()).match(re)) {
                        found = true;
                        request(m.find('a').attr('href'), function (error, response, body) {
                            var $ = cheerio.load(substitute(body));
                            oneResult($, $('.panel'));
                        });
                    }
                });
            } else {
                manyResults($, matches);
            }
        } else {
            noResults();
        }
    });
}

/**
 * Empty function to use in place of missing callbacks
 */
function _noop () {}

