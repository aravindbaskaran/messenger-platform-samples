'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');
const dbconnect = require('./dbconnect');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN || "d6f2d78a377b4cc4bf197283e5a73f02";
const APIAI_LANG = process.env.APIAI_LANG || 'en';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "ban_kai";
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || "EAAPU3hK7RPYBAHY1GdjgivrOgCqBmK1ZAE68wDosMgHaaP9ZCLheC9fVbyiuz4TX3yJgC2TQqAGvTrBnet7CngKYz2lwZAZCQAZAHYallxpBVFW0tP9DPdTbac3EOzgaqSPopcUBf37SNgz63cuMtd4gZBgHn7i26jXkv57geAZAwZDZD";

const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
const sessionIds = new Map();

const fbReq = request.defaults({
  uri: 'https://graph.facebook.com/me/messages',
  method: 'POST',
  json: true,
  qs: { access_token: FB_PAGE_ACCESS_TOKEN },
  headers: {'Content-Type': 'application/json'},
});
const fbMessage = (recipientId, msg, cb) => {
  const opts = {
    form: {
      recipient: {
        id: recipientId,
      },
      message: {
        text: msg,
      },
    },
  };
  fbReq(opts, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
};
const createProductPayload = (product, query) =>{
  return {
    title: product.pagetitle,
    subtitle: "$ " + product.price + product.category,
    item_url: product.fullurl,
    image_url: product.imageurl,
    buttons: [{
      type: "postback",
      title: "Buy",
      payload: JSON.stringify({product: product, action: "buy", query: query})
    },{
      type: "postback",
      title: "Keep for later",
      payload: JSON.stringify({product: product, action: "later", query: query})
    },/*{
      type: "postback",
      title: "Add to Wishlist",
      payload: "wishlist"//JSON.stringify({product: product, action: "wishlist", query: query})
    },*/{
      type: "web_url",
      url: product.fullurl,
      title: "Open on browser"
    }

    ]
  };
};
const fbSendDataMessage = (recipientId, products, cb) =>{
  const elements = [];
  products.forEach(function(p){
    elements.push(createProductPayload(p));
  });
  console.log("In getProducts callback", elements);
  const messageData = {
    form: {
      recipient: {
        id: recipientId
      },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: elements
          }
        }
      }
    }
  };
  fbReq(messageData, (err, resp, data) => {
    if (cb) {
      cb(err || data.error && data.error.message, data);
    }
  });
}

function processEvent(event) {
    var sender = event.sender.id.toString();

    if (event.message && event.message.text) {
        var text = event.message.text;
        // Handle a text message from this sender

        if (!sessionIds.has(sender)) {
            sessionIds.set(sender, uuid.v1());
        }

        console.log("Text", text);

        let apiaiRequest = apiAiService.textRequest(text,
            {
                sessionId: sessionIds.get(sender)
            });

        apiaiRequest.on('response', (response) => {
            if (isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let action = response.result.action;
                console.log(response.result);

                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                    try {
                        console.log('Response as formatted message');
                        sendFBMessage(sender, responseData.facebook);
                    } catch (err) {
                        sendFBMessage(sender, {text: err.message });
                    }
                } else if (isDefined(responseText)) {
                    console.log('Response as text message');
                    // facebook API limit for text length is 320,
                    // so we split message if needed
                    var splittedText = splitResponse(responseText);

                    async.eachSeries(splittedText, (textPart, callback) => {
                        sendFBMessage(sender, {text: textPart}, callback);
                    });
                }
                if(response.result.action != "start_search"){
                  sendFBMessage(sender, {text: "I totally didn't get you, can you ask me something else?"});
                }else if(!response.result.actionIncomplete){
                  console.log(response.result.parameters);
                  dbconnect.getProducts({
                    category: response.result.parameters.category,
                    name: response.result.parameters.category,
                    userID: sender
                  }, function(products){
                    if(products.length == 0){
                      sendFBMessage(sender, {text: "We couldn't find anything like that, please try again :("});
                    }else{
                      fbSendDataMessage(sender, products);
                    }
                  });
                }

            }else{
              sendFBMessage(sender, {text: "I totally didn't get you, can you ask me something else?"});
            }
        });

        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();
    }
}

function splitResponse(str) {
    if (str.length <= 320)
    {
        return [str];
    }

    var result = chunkString(str, 300);

    return result;

}

function chunkString(s, len)
{
    var curr = len, prev = 0;

    var output = [];

    while(s[curr]) {
        if(s[curr++] == ' ') {
            output.push(s.substring(prev,curr));
            prev = curr;
            curr += len;
        }
        else
        {
            var currReverse = curr;
            do {
                if(s.substring(currReverse - 1, currReverse) == ' ')
                {
                    output.push(s.substring(prev,currReverse));
                    prev = currReverse;
                    curr = currReverse + len;
                    break;
                }
                currReverse--;
            } while(currReverse > prev)
        }
    }
    output.push(s.substr(prev));
    return output;
}

function sendFBMessage(sender, messageData, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
        }
    }, function (error, response, body) {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }

        if (callback) {
            callback();
        }
    });
}

function doSubscribeRequest() {
    request({
            method: 'POST',
            uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        function (error, response, body) {
            if (error) {
                console.error('Error while subscription: ', error);
            } else {
                console.log('Subscription result: ', response.body);
            }
        });
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

const app = express();

app.use(bodyParser.text({ type: 'application/json' }));

app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] == FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);

        setTimeout(function () {
            doSubscribeRequest();
        }, 3000);
    } else {
        res.send('Error, wrong validation token');
    }
});

const receivedPostback = (event) => {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  var message = "Postback called!";

  var payloadObj = JSON.parse(payload);
  if(payloadObj.action == "buy"){
    // Actual buy
    // Add score to result for product, query, senderID
    message = "Thank you for buying! We will take you to the store to checkout";
  }else if(payloadObj.action == "later"){
    // Actual watchlist
    // Add score to result for product, query, senderID
    message = "OK, we will let you know when the price changes";
  }else if(payloadObj.action == "wishlist"){
    // Actual wishlist
    // Add score to result for product, query, senderID
    message = "Saved to your wishlist, just for you";
  }

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  //sendTextMessage(senderID, "Postback called");
  fbMessage(senderID, message, (err, data) => {
    if (err) {
      console.log(
        'Oops! An error occurred while forwarding the response to',
        recipientID,
        ':',
        err
      );
    }
  });
}

app.post('/webhook/', function (req, res) {
    try {
        var data = JSONbig.parse(req.body);

        var messaging_events = data.entry[0].messaging;
        for (var i = 0; i < messaging_events.length; i++) {
            var event = data.entry[0].messaging[i];
            if(event.postback){
              receivedPostback(event);
            }else{
              processEvent(event);
            }
        }
        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.listen(REST_PORT, function () {
    console.log('Rest service ready on port ' + REST_PORT);
});

doSubscribeRequest();
