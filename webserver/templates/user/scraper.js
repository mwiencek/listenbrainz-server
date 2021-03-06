function makeURIObject(lastfmURI, spotifyURI) {

}

function select(selector, collection) {
    var newCollection = [];
    for (var i = 0; i < collection.length; i++) {
        if (selector(collection[i])) {
            newCollection.push(collection[i]);
        }
    }

    return newCollection;
}

function map(applicable, collection) {
    var newCollection = [];
    for (var i = 0; i < collection.length; i++) {
        newCollection.push(applicable(collection[i]));
    }

    return newCollection;
}

function each(applicable, collection) {
    for (var i = 0; i < collection.length; i++) {
        applicable(collection[i]);
    }
}

function isSpotifyURI(uri) {
    return !!(/open.spotify/.exec(uri));
}

var Scrobble = (function() {
    return function(rootScrobbleElement) {
        this.lastfmID = function() {
            var loveButtonForm = rootScrobbleElement.getElementsByTagName("form")[0];
            var loveButtonURL = loveButtonForm.getAttribute("action");
            return extractlastFMIDFromLoveButtonURL(loveButtonURL);
        }

        this.artistName = function() {
            var artistElement = rootScrobbleElement.getElementsByClassName("chartlist-artists")[0];
            artistElement = artistElement.children[0];
            var artistName = artistElement.textContent || artistElement.innerText;
            return artistName;
        }

        this.trackName = function() {
            var trackElement = rootScrobbleElement.getElementsByClassName("link-block-target")[0];
            return trackElement.textContent || trackElement.innerText;
        }

        this.scrobbledAt = function() {
            var dateContainer = rootScrobbleElement.getElementsByClassName("chartlist-timestamp")[0]
            if (!dateContainer) {
                return 0;
            }
            var dateElement = dateContainer.getElementsByTagName("span")[0];
            var dateString = dateElement.getAttribute("title");
            //we have to do this because javascript's date parse method doesn't
            //directly accept lastfm's new date format but it does if we add the
            //space before am or pm
            var manipulatedDateString = dateString.replace("am", " am").replace("pm", " pm") + " UTC";
            return Math.round(Date.parse(manipulatedDateString)/1000);
        }

        this.optionalSpotifyID = function() {
            return select(
                    isSpotifyURI,
                    map(
                        function(elem) { return elem.getAttribute("href") },
                        rootScrobbleElement.getElementsByTagName("a")
                       )
                    )[0];
        }

        this.asJSONSerializable = function() {
            return {
                "track_metadata": {
                    "track_name": this.trackName(),
                    "artist_name": this.artistName(),
                    "additional_info" : {
                         "spotify_id": this.optionalSpotifyID()
                    },
                },
                "listened_at": this.scrobbledAt()

            }
        }

        function extractlastFMIDFromLoveButtonURL(loveButtonURL) {
            var parts = loveButtonURL.split("/");
            return parts.slice(0, parts.length-1).join("/");
        }
    }
}());

function encodeScrobbles(root) {
    var scrobbles = root.getElementsByClassName("js-link-block");
    var parsedScrobbles = map(function(rawScrobble) {
        var scrobble = new Scrobble(rawScrobble);
        return scrobble.asJSONSerializable();
    }, scrobbles);

    var structure = {
        "listen_type" : "import",
        "payload"     : parsedScrobbles
    }

    return structure;
}

function getLastFMPage(page, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", encodeURI("http://www.last.fm/user/{{ lastfm_username }}/library?page=" + page + "&_pjax=%23content"));
    xhr.onload = function(content) {
        callback(xhr.response);
    };
    xhr.send();
}

var version = "1.2";
var page = 1;
var numberOfPages = parseInt(document.getElementsByClassName("pages")[0].innerHTML.trim().split(" ")[3]);

var toReport = [];
var numCompleted = 0;
var activeSubmissions = 0;

var timesDispatch = 0;
var timesReportScrobbles = 0;
var timesEnqueueReport = 0;
var timesGetPage = 0;
var times4Error = 0;
var times5Error = 0;

function dispatch() {
    timesDispatch++;
    for (var i = 0; i < toReport.length; ++i) {
        reportScrobbles(toReport[i]);
    }
    toReport = [];
}

function enqueueReport(struct) {
    timesEnqueueReport++;
    if (struct.payload.length > 0) {
        toReport.push(struct);
        dispatch();
    }
}

function reportScrobbles(struct) {
    timesReportScrobbles++;
    //must have a trailing slash
    var reportingURL = "{{ base_url }}";
    activeSubmissions++;

    var xhr = new XMLHttpRequest();
    xhr.open("POST", reportingURL);
    xhr.setRequestHeader("Authorization", "Token {{ user_token }}");
    xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xhr.timeout = 10 * 1000; // 10 seconds
    xhr.onload = function(content) {
        if (this.status >= 200 && this.status < 300) {
            numCompleted++;
            console.log("successfully reported page");
        } else if (this.status >= 400 && this.status < 500) {
            times4Error++;
            // We mark 4xx errors as completed because we don't
            // retry them
            numCompleted++;
            console.log("4xx error, skipping");
        } else if (this.status >= 500) {
            console.log("received http error " + this.status + " req'ing");
            times5Error++;
            enqueueReport(struct);
        }
        if (numCompleted >= numberOfPages) {
            updateMessage("<i class='fa fa-check'></i> Import finished<br><span style='font-size:8pt'>Thank you for using ListenBrainz</span>");
        } else {
            updateMessage("<i class='fa fa-cog fa-spin'></i> Sending page " + numCompleted + " of " + numberOfPages + " to ListenBrainz<br><span style='font-size:8pt'>Please don't navigate while this is running</span>");
        }
        getNextPageIfSlots();
    };
    xhr.ontimeout = function(context) {
        console.log("timeout, req'ing");
        enqueueReport(struct);
    }
    xhr.onabort = function(context) {
        console.log("abort, req'ing");
        enqueueReport(struct);
    };
    xhr.onerror = function(context) {
        console.log("error, req'ing");
        enqueueReport(struct);
    };
    xhr.onloadend = function(context) {
        activeSubmissions--;
    }
    xhr.send(JSON.stringify(struct));
}

function reportPage(response) {
    var elem = document.createElement("div");
    elem.innerHTML = response;
    var struct = encodeScrobbles(elem);
    enqueueReport(struct);
}

function reportPageAndGetNext(response) {
    timesGetPage++;
    if (page == 1) {
      updateMessage("<i class='fa fa-cog fa-spin'></i> working<br><span style='font-size:8pt'>Please don't navigate away from this page while the process is running</span>");
    }
    reportPage(response);

    getNextPageIfSlots();
}

function getNextPageIfSlots() {
    // Get a new lastfm page and queue it only if there are more pages to download and we have
    // less than 10 pages waiting to submit
    if (page <= numberOfPages && activeSubmissions < 10) {
        page += 1;
        setTimeout(function() { getLastFMPage(page, reportPageAndGetNext) }, 0 + Math.random()*100);
    }
}

function updateMessage(message) {
    document.getElementById("listen-progress-container").innerHTML =  "" +
        "<img src='{{ url_for('static', filename='img/listenbrainz-logo.svg', _external=True) }}' height='75'><br><br>" +
        message + "<br>" +
        "<span style='display:none'>" +
        "dispatched " + timesDispatch + ", reportedScrobbles " +
        timesReportScrobbles + ", enqueueReport " + timesEnqueueReport +
        ", getPage " + timesGetPage + ", number4xx " + times4Error +
        ", number5xx " + times5Error + ", page " + page + "</span>" +
        "<br><span style='font-size:6pt; position:absolute; bottom:1px; right: 3px'>v"+version+"</span>";
}

document.body.insertAdjacentHTML( 'afterbegin', '<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.4.0/css/font-awesome.min.css">');
document.body.insertAdjacentHTML( 'afterbegin', '<div style="position:absolute; top:200px; z-index: 200000000000000; width:500px; margin-left:-250px; left:50%; background-color:#fff; box-shadow: 0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22); text-align:center; padding:50px;" id="listen-progress-container"></div>');
updateMessage("");
getLastFMPage(page, reportPageAndGetNext);
