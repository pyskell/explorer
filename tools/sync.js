/*
If you don't want to use localhost node but a remote node to grab and sync blocks from.
Copy and paste the sync.json from the ./tools/ directory to the root directory of explorer.
And setup the remote NODE address and port before luanching the app.
Use grabber.js and grabberConfig.json to setup and sync the rest of the chain.
*/
require( '../db.js' );
var etherUnits = require("../lib/etherUnits.js");
var BigNumber = require('bignumber.js');

var fs = require('fs');
var Web3 = require('web3');

var mongoose        = require( 'mongoose' );
var Block           = mongoose.model( 'Block' );
var Transaction     = mongoose.model( 'Transaction' );

//Just lsiten for latest blocks and sync from the start of the app.
var listenBlocks = function(config) {
    // Sets address for RPC WEb3 to connect to, usually your node address defaults ot localhost
    var web3 = new Web3(new Web3.providers.HttpProvider('http://' + config.nodeAddr + ':' + config.gethPort.toString()));
    var newBlocks = web3.eth.filter("latest");
    newBlocks.watch(function (error, log) {
        if(error) {
            console.log('Error: ' + error);
        } else if (log == null) {
            console.log('Warning: null block hash');
        } else {
          console.log('Found new block: ' + log);
          grabBlock(config, web3, log);
        }
    });
}
//Grab latest block info and it transactions and write to db
var grabBlock = function(config, web3, blockHashOrNumber) {
    var desiredBlockHashOrNumber;
    // check if done
    if(blockHashOrNumber == undefined) {
        return;
    }
    if (typeof blockHashOrNumber === 'object') {
        if('start' in blockHashOrNumber && 'end' in blockHashOrNumber) {
            desiredBlockHashOrNumber = blockHashOrNumber.end;
        }
        else {
            console.log('Error: Aborted becasue found a interval in blocks ' + 'array that doesn\'t have both a start and end.');
            process.exit(9);
        }
    }
    else {
        desiredBlockHashOrNumber = blockHashOrNumber;
    }
    if(web3.isConnected()) {
        web3.eth.getBlock(desiredBlockHashOrNumber, true, function(error, blockData) {
            if(error) {
                console.log('Warning: error on getting block with hash/number: ' +   desiredBlockHashOrNumber + ': ' + error);
            }
            else if(blockData == null) {
                console.log('Warning: null block data received from the block with hash/number: ' + desiredBlockHashOrNumber);
            }
            else {
              //checkBlockDBExistsThenWrite(config, blockData);
              writeBlockToDB(config, blockData);
              writeTransactionsToDB(config, blockData);

              if('syncAll' in config && config.syncAll === true){
                var lastBlock = blockData.number
                console.log('Last block captured: ' + lastBlock);
                updateENDblock(lastBlock);
                return;
              }else{
                return;
              }
            }
        });
    }
    else {
        console.log('Error: Aborted due to web3 is not connected when trying to ' + 'get block ' + desiredBlockHashOrNumber);
        process.exit(9);
    }
}
var writeBlockToDB = function(config, blockData) {
    return new Block(blockData).save( function( err, block, count ){
        if ( typeof err !== 'undefined' && err ) {
            if (err.code == 11000) {
                console.log('Skip: Duplicate key ' +   blockData.number.toString() + ': ' + err);
            } else {
               console.log('Error: Aborted due to error on ' + 'block number ' + blockData.number.toString() + ': ' +  err);
               process.exit(9);
           }
        } else {
            if(!('quiet' in config && config.quiet === true)) {
                console.log('DB successfully written for block number ' + blockData.number.toString() );
            }
        }
      });
}
/**
    Break transactions out of blocks and write to DB
**/
var writeTransactionsToDB = function(config, blockData) {
    var bulkOps = [];
    if (blockData.transactions.length > 0) {
        for (d in blockData.transactions) {
            var txData = blockData.transactions[d];
            txData.timestamp = blockData.timestamp;
            txData.value = etherUnits.toEther(new BigNumber(txData.value), 'wei');
            bulkOps.push(txData);
        }
        Transaction.collection.insert(bulkOps, function( err, tx ){
            if ( typeof err !== 'undefined' && err ) {
                if (err.code == 11000) {
                    console.log('Skip: Duplicate key ' +
                    err);
                } else {
                   console.log('Error: Aborted due to error: ' +
                        err);
                   process.exit(9);
               }
            } else if(!('quiet' in config && config.quiet === true)) {
                console.log(blockData.transactions.length.toString() + ' transactions recorded for Block# ' + blockData.number.toString());
            }
        });
    }
}
var checkBlockDBExistsThenWrite = function(config, blockData) {
    Block.find({number: blockData.number}, function (err, b) {
        if (!b.length){
            writeBlockToDB(config, blockData);
        }else {
            console.log('Block number: ' + blockData.number.toString() + ' already exists in DB.');
            listenBlocks(config);
        }

    })
}
/**
Take the last block the grabber exited on and update the param 'end' in the config.JSON
**/
var updateENDblock = function(lastBlock){

  var fileName = './config.json';
  var file = require(fileName);

  file.end = lastBlock;

  fs.writeFile(fileName, JSON.stringify(file), function (err) {
    if (err) return console.log(err);
    JSON.stringify(file, null, 2)
    console.log('writing to ' + fileName);
  });
}

/*Start config for node connection and sync*/
var config = {};
// set the default NODE address to localhost if it's not provided
if (!('nodeAddr' in config) || !(config.nodeAddr)) {
    config.nodeAddr = 'localhost'; // default
}
// set the default geth port if it's not provided
if (!('gethPort' in config) || (typeof config.gethPort) !== 'number') {
    config.gethPort = 8545; // default
}
// set the default output directory if it's not provided
if (!('output' in config) || (typeof config.output) !== 'string') {
    config.output = '.'; // default this directory
}
//Look for config.json file if not
try {
    var configContents = fs.readFileSync('conf.json');
    config = JSON.parse(configContents);
    console.log('CONFIG FOUND: Node:'+config.nodeAddr+' | Port:'+config.gethPort);
}
catch (error) {
    if (error.code === 'ENOENT') {
        console.log('No config file found. Using default configuration: Node:'+config.nodeAddr+' | Port:'+config.gethPort);
    }
    else {
        throw error;
        process.exit(1);
    }
}

listenBlocks(config);
