var express = require('express');
var app = express();
var cors = require('cors');
var Web3 = require('web3');
// HTTPS Server Stuff
var fs = require('fs');
var https = require('https');
var http = require('http');
var HookedWeb3Provider = require("hooked-web3-provider");
var lightwallet = require("eth-lightwallet");
var config = require('./config.json');
var Firebase = require('firebase');
var Queue = require('firebase-queue');
var myRootRef = new Firebase(config.firebase.url);

var faucet_keystore = JSON.stringify(require("./wallet.json"));
var secretSeed = lightwallet.keystore.generateRandomSeed();

var tokenaddr = {
  "zrx": "0x6ff6c0ff1d68b964901f986d4c9fa3ac68346570",
  "mkr": "0x1dad4783cf3fe3085c1426157ab175a6119a04ba",
  "mln": "0x323b5d4c32345ced77393b3530b1eed0f346429d",
  "rep": "0xb18845c260f680d5b9d84649638813e342e4f8c9",
  "dgd": "0xeee3870657e4716670f185df08652dd848fe8f7e",
  "gnt": "0xef7fff64389b814a946f3e92105513705ca6b990",
  "dai": "0xc4375b7de8af5a38a93548eb8453a498222c4ff2"
};

// 0.1: 000000000000000000000000000000000000000000000000016345785D8A0000
// 1.0: 0000000000000000000000000000000000000000000000000de0b6b3a7640000
// 10:  0000000000000000000000000000000000000000000000008ac7230489e80000
// 100: 0000000000000000000000000000000000000000000000056bc75e2d63100000
var tokenamt = {
  "zrx": "000000000000000000000000000000000000000000000000016345785D8A0000",
  "mkr": "0000000000000000000000000000000000000000000000056bc75e2d63100000",
  "mln": "0000000000000000000000000000000000000000000000056bc75e2d63100000",
  "rep": "0000000000000000000000000000000000000000000000056bc75e2d63100000",
  "dgd": "0000000000000000000000000000000000000000000000056bc75e2d63100000",
  "gnt": "0000000000000000000000000000000000000000000000056bc75e2d63100000",
  "dai": "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
};

// check for valid Eth address
function isAddress(address) {
	return /^(0x)?[0-9a-f]{40}$/i.test(address);
};

// Add 0x to address 
function fixaddress(address) {
	// Strip all spaces
	address = address.replace(' ', '');

	//console.log("Fix address", address);
	if (!strStartsWith(address, '0x')) {
		return ('0x' + address);
	}
	return address;
}

function strStartsWith(str, prefix) {
	return str.indexOf(prefix) === 0;
}

var account;
var web3;

var nextdrip;


myRootRef.authWithCustomToken(config.firebase.secret, function(error, authData) {
	if (error) {
		console.log("Firebase Login Failed!", error);
		proccess.exit();
	} else {
		console.log("Firebase Login Succeeded!", authData);

		lightwallet.keystore.deriveKeyFromPassword("test", function(err, pwDerivedKey) {

			var keystore = new lightwallet.keystore.deserialize(faucet_keystore);

			console.log('connecting to ETH node: ', config.web3.host);

			var web3Provider = new HookedWeb3Provider({
				host: config.web3.host,
				transaction_signer: keystore
			});

			web3 = new Web3();
			web3.setProvider(web3Provider);

			keystore.passwordProvider = function(callback) {
				callback(null, "testing");
			};

			console.log("Wallet initted addr=" + keystore.getAddresses()[0]);

			account = fixaddress(keystore.getAddresses()[0]);

			// start webserver...
			//app.listen(config.httpport, function() {
			//	console.log('Fawcet listening on port ', config.httpport);
			//});
      // NEW WEBSERVER STUFF

      // HTTPS Server Stuff
      var key = fs.readFileSync('/etc/letsencrypt/live/faucet.tokenpla.net/privkey.pem');
      var cert = fs.readFileSync('/etc/letsencrypt/live/faucet.tokenpla.net/fullchain.pem');
      var ca = fs.readFileSync('/home/brandon/repo/locals-faucetserver/static/locals-faucet/app/isrgrootx1.pem');
      var httpsopts = {
        key: key,
        cert: cert,
        ca: ca
      };

      // CREATE HTTPS SERVER
      https.createServer(httpsopts, app).listen(3002);
      http.createServer(app).listen(3001);
		});
	}
});

function getTimeStamp() {
	return Math.floor(new Date().getTime() / 1000);
}

// Get faucet balance in ether ( or other denomination if given )
function getFaucetBalance(denomination) {
	return parseFloat(web3.fromWei(web3.eth.getBalance(account).toNumber(), denomination || 'ether'));
}

//app.use(cors());
app.use(cors(), function(req, res, next) {
  if (req.secure) {
    next();
  } else {
    res.redirect('https://' + req.headers.host + req.url);
  }
});

// polymer app is served from here
//app.use(express.static('static/locals-faucet/dist'));
// HTTP → HTTPS Redirect
app.use(express.static('static/locals-faucet/dist'), function(req, res, next) {
  if (req.secure) {
    next();
  } else {
    res.redirect('https://' + req.headers.host + req.url);
  }
});

var randomQueueName = "queue" + Date.now();
var blacklistName = "blacklist";

// get current faucet info
app.get('/faucetinfo', function(req, res) {
	var etherbalance = -1;
	try {
		etherbalance = getFaucetBalance();
	} catch (e) {
		console.log(e);
	}
	res.status(200).json({
		account: account,
		balance: etherbalance,
		etherscanroot: config.etherscanroot,
		payoutfrequencyinsec: config.payoutfrequencyinsec,
		payoutamountinether: config.payoutamountinether,
		payoutamountintokens: config.payoutamountintokens,
		payoutamountinzrx: config.payoutamountinzrx,
		payoutamountindai: config.payoutamountindai,
		queuesize: config.queuesize,
		queuename: randomQueueName
	});
});

// Creates the Queue
var options = {
	numWorkers: config.queuesize,
	sanitize: false
};

var queueRef = myRootRef.child(randomQueueName);
var blacklist = myRootRef.child(blacklistName);

var nextpayout = getTimeStamp();

var queue = new Queue(queueRef, options, function(data, progress, resolve, reject) {
	// Read and process task data
	console.log('queue item is here...')
	console.log(data);

	// if (nextpayout - getTimeStamp() > 0) {
	// need to wait 
	var delay = data.paydate - getTimeStamp();
	console.log('next payout in ', delay, 'sec');

	if (delay < 0) {
		delay = 0;
	}
	setTimeout(function() {


		donate(data.address, data.token, function(err, result) {
			if (err) {
				console.log(err);
				reject();
			}

			queueRef.child('tasks').child(data._id).child('txhash').set(result)
				.then(function() {
					console.log('tx set');
				});

			setTimeout(function() {
				resolve();
				console.log('resolved');
			}, 20 * 1000);
		});

	}, delay * 1000);

});

app.get('/blacklist/:address', function(req, res) {
	var address = fixaddress(req.params.address);
	if (isAddress(address)) {
		blacklist.child(address).set(Date.now());
		res.status(200).json({
			msg: 'address added to blacklist'
		});
	} else {
		return res.status(400).json({
			message: 'the address is invalid'
		});
	}
});

// add our address to the donation queue
app.get('/donate/:token/:address', function(req, res) {
	console.log('push');

  var token = req.params.token;
	var address = fixaddress(req.params.address);
	if (isAddress(address)) {
		blacklist.child(address).once('value', function(snapshot) {
			var exists = (snapshot.val() !== null);
			if (exists) {
				return res.status(200).json({
					paydate: 0,
					address: address,
					amount: 0
				});
			}

			var queuetasks = queueRef.child('tasks');
			queuetasks.once('value', function(snap) {

				// first time
				if (!nextdrip) {
					nextdrip = getTimeStamp();
				}

				var queueitem = {
					paydate: nextdrip,
					address: address,
					amount: 1 * 1e18,
          token: token
				};

				var list = snap.val();
				if (list) {
					var length = Object.keys(list).length;
					if (length >= config.queuesize) {
						// queue is full - reject request
						return res.status(403).json({
							msg: 'queue is full'
						});
					}
				}

				queuetasks.push(queueitem);
				nextdrip += config.payoutfrequencyinsec;
				return res.status(200).json(queueitem);
			});
		});

	} else {
		return res.status(400).json({
			message: 'the address is invalid'
		});

	}



});

function donate(to, token, cb) {

	web3.eth.getGasPrice(function(err, result) {

		var gasPrice = 1000000000;
		//var gasPrice = result.toNumber(10);
		console.log('calculated gas price is', gasPrice/1000000000, 'gwei');
                //if (gasPrice < 12000000000) {
		//	console.log('defaulting to minimum gas price of 12 gwei');
		//	gasPrice = 12000000000;
		//}

		var amount;
		console.log("Transferring", token, "=", amount, "wei from", account, 'to', to);

    var options;

    if (token === 'eth') {
      amount = config.payoutamountinether * 1e18;
		  options = {
			  from: account,
			  to: to,
			  value: amount,
			  gas: 314150,
			  gasPrice: gasPrice,
		  };
    } else {
		  options = {
			  from: account,
			  to: tokenaddr[token],
			  value: 0,
			  gas: 314150,
			  gasPrice: gasPrice,
        data: "0xa9059cbb000000000000000000000000" + to.substring(2) + tokenamt[token]
		  };
    }
//		if (amount == 0) {
//			options.data = "0x"
//		}

		console.log(options);
		web3.eth.sendTransaction(options, function(err, result) {

			if (err != null) {
				console.log(err);
				console.log("ERROR: Transaction didn't go through. See console.");
				console.log(result);
			} else {
				console.log("Transaction Successful!");
				console.log(result);
			}

			return cb(err, result);

		});
	});
}
