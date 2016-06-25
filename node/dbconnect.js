//lets require/import the mongodb native drivers.
var mongodb = require('mongodb');

//We need to work with "MongoClient" interface in order to connect to a mongodb server.
var MongoClient = mongodb.MongoClient;
var mongoose = require('mongoose');

// Create your schemas and models here.
var resultSchema = new mongoose.Schema ({
	query: Object,
	productID: String,
	userID: String,
	score: Number,
	lastUpdatedAt: Date
});

var Results = mongoose.model('Results', resultSchema);

resultSchema.pre('save', function(next){
	this.lastUpdatedAt = new Date();
	next();
});

// Connection URL. This is where your mongodb server is running.
var url = 'mongodb://localhost:27017/productdb';

	//find products matching the input query
	var findProducts = function( category, name, userid, callback) {

		// Use connect method to connect to the Server
		MongoClient.connect(url, function (err, db) {
		if (err) {
			console.log('Unable to connect to the mongoDB server. Error:', err);
		} else {
			//HURRAY!! We are connected. :)
			console.log('Connection established to', url);

			
			var db1 = mongoose.connection;

			db1.on('error', console.error.bind(console, 'connection error:'));

			mongoose.connect('mongodb://localhost:27017/productdb');

			// do some work here with the database.
			var categoryR = new RegExp(".*"+category+".*", "i");
			var pageTitleR = new RegExp(".*"+name+".*", "i");
			var cursor = db.collection('products').find({
				$or:[{"category": categoryR}, {"pagetitle": pageTitleR}]
				}).limit(10).toArray(function(err, productArray){
			  
			  for(var i=0; i < productArray.length; i++){
			  	console.log("productid", productArray[i].productid);
			  	var j = new Results({
			  		query:{category:category, pageTitle:name},
			  		productID:productArray[i].productid,
			  		userID:userid
			  	});
			  	createResultIfNotExists(j);
				};
				callback(productArray);
				db.close();
			});
			}
		});
	};
	function createResultIfNotExists(j){
		Results.findOne(j).exec(function(err, r){
  		//console.log( 'printing r', r);
  		if(r==null){
  			//console.log("creating j", j);
				j.score = 0;
				j.save(function(err, x) {
					 //if (err) return console.error(err);
					 //console.log("Created J", x);
					//console.dir(j);
				});
  		}
  	});
	}

	// Get products matching the params
	function getProducts(queryParams, callback){
		var category = queryParams.category;
		var name = queryParams.name;
		var userID = queryParams.userID;
		findProducts (category, name, userID, function(productArray){
			console.log(productArray.length);
			callback(productArray);
		});
	}

	//var data = {category:"CLOTHING", name:"Blue", userID:"Aravind"};
	//getProducts(data);
module.exports = {
	getProducts: getProducts
};
