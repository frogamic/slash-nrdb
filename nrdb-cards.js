var request = require('request');
var cheerio = require('cheerio');

var maxHits = process.env.MAX_HITS || 200;
var colours = require('./colours.json');
var shorthands = require('./shorthands.json');
var shorthandRegExp = new RegExp(Object.keys(shorthands).reduce(function (pv, cv, ci, a) {
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

exports.find = function (text, messages, responder) {
    search(text, function ($, panel) {
        responder(formatSingle($, panel, messages));
    }, function ($, matches) {
        responder(formatMultiple($, matches, messages));
    }, function () {
        responder({'text': messages.NO_RESULTS});
    }, function () {
        responder(null);
    });
}

/**
 * Converts a list of cards as returned by NetrunnerDB into a text list to be returned to slack
 *
 * @param   matches The array of cards matching the query, returned from NRDB
 */
function formatMultiple ($, matches, messages) {
    var a = {'text':'', 'attachments':[{text:''}]};
    var hits = matches.length;

    if (hits > maxHits) {
        return {'text': hits + messages.TOO_MANY};
    }

    a.text = hits + messages.MULTIPLE_RESULTS;
    matches.each(function (i, e) {
        e = $(e);
        var text = clean(e.text());
        var url = e.find('a').attr('href');
        a.attachments[0].text += '• <' + url + '|' + text + '>\n'; 
    });

    return a;
}

function formatCardInfo(info, faction) {
    info = info.replace(/ • /, '\n');
    info = info.replace(/ • /g, ' - ');
    info += ' - :_' + faction.toLowerCase() + ':';
    if (!info.match(/(Agenda|Identity)/)) {
        var influence = parseInt(info.replace(/(?:.|\s)*Influence: (\d+).*/, '$1'));
        info = info.replace(/ - Influence: \d+/, '');
        for (var i = 0; i < influence; i++) {
            info += '•';
        }
    }
    info = info.replace(/^(.*?)(\n|:)/, '*$1*$2');
    info = info.replace(/Memory: (\d)/, ':_$1mu:');
    info = info.replace(/Strength: (\d+)/, '$1 Str');
    info = info.replace(/(?:Install|Cost): (\d+)/, '$1:_credit:');
    info = info.replace(/Rez: (\d+)/, '$1:_rez:');
    info = info.replace(/Adv: (\d+)/, '$1 Adv');
    info = info.replace(/Score: (\d+)/, '$1:_agenda:');
    info = info.replace(/Trash: (\d+)/, '$1:_trash:');
    info = info.replace(/Link: (\d+)/, '$1:_link:');
    info = info.replace(/Influence: (\d+)/, '$1•');
    return info;
}

/**
 * Converts a single card from NetrunnerDB into text to be returned to slack.
 */
function formatSingle ($, panel) {
    var a = {'text':'', 'attachments':[{pretext:'', text:''}]};
    var title = clean(panel.find('.panel-heading').text()).replace('♦', '◆');
    var faction = clean(panel.find('.card-illustrator').text()).replace(/ .*/, '');
    var info = clean(panel.find('.card-info').text());
    a.text = '<' + panel.find('a.card-title').attr('href');
    a.text +=  '|*' + title + '*>\n';
    a.attachments[0].pretext = formatCardInfo(info, faction);
    panel.find('.card-text p').each(function (i, p) {
        a.attachments[0].text += clean($(p).text()) + '\n';
    });
    a.attachments[0].fallback = 'NRDB results for ' + title;
    a.attachments[0].mrkdwn_in = ['pretext', 'text'];
    a.attachments[0].color = colours[faction];
    return a;
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
    body = body.replace(/([1-3])<span class="icon icon-mu"><\/span>/g, ':_$1mu:');
    body = body.replace(/<span class="icon icon-mu"><\/span>/g, ':_mu:');
    body = body.replace(/<span class="icon icon-([1-3])mu"><\/span>/g, ':_$1mu:');
    body = body.replace(/<span class="icon icon-recurring-credit"><\/span>/g, ':_recurringcredit:');
    body = body.replace(/<span class="icon icon-subroutine"><\/span>/g, ':_subroutine:');
    body = body.replace(/<\/?strong>/g, '*');
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
 * @param Function errorResult Callback if there was an error
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


    text = text.toLowerCase().replace(shorthandRegExp, function(sh){
        return shorthands[sh];
    });

    request('http://netrunnerdb.com/find/?q=' + text, function (error, response, body) {
        if (error || response.statusCode !== 200) {
            return errorResult();
        }
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
                    var re = new RegExp('^'+text, 'i');
                    if (!found && clean(m.text()).match(re)) {
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

