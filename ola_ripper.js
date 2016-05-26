#!/usr/bin/env node

"use strict";

let /*PDFParser = require("pdf2json"),*/
	Rx = require('rxjs'),
	StringObservable = require('./observables/string.js'),
	EventEmitter = require('events').EventEmitter,
	Fs = require('fs'),
	Cproc = require('child_process'),
	Co = require('co'),
	Mysql = require('mysql');

let filePath = process.argv[2];
let pdfCheck = new RegExp(/pdf$/i);
let exportPath = process.argv[3];
let csvCheck = new RegExp(/csv$/i);

let olaSummaryPayments = new RegExp(/\s*S\s*u\s*m\s*m\s*a\s*r\s*y\s*o\s*f\s*P\s*a\s*y\s*m\s*e\s*n\s*t\s*s\s*f\s*r\s*o\s*m\s*O\s*l\s*a([A-Za-z\s\d-₹,.()]*?)T\s*o\s*t\s*a\s*l\s*-*\s*₹*\s*([\d.,])*/);

let nullableSummaryPattern = new RegExp(/\s*N\s*o\s*P\s*a\s*y\s*m\s*e\s*n\s*t\s*i\s*n\s*f\s*o\s*r\s*m\s*a\s*t\s*i\s*o\s*n\s*f\s*o\s*u\s*n\s*d\s*/)

let olaNeftPattern = new RegExp(/(.*?NEFT\s*-*\s*₹*[\d,.]*)/igm);

let extractNeftPattern = new RegExp(/(\d{2}-\d{2}-\d{4})*\s*([a-zA-Z\d]*)\s+([\d]*)\s+(NEFT)\s+(-*\s*₹*[\d,.]*)/);

let extractPureAmount = new RegExp(/(-*\s*₹*[\d.])/g);

let fileStat = (path) => {
	 return new Promise((resolve, reject) => {
			Fs.stat(path, (err, stat) => {
						if(err) {
							reject(err);
						}else {
							resolve(stat);
						}
					});
		 });
};

let dbConn = Mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : 'abcd!234',
  database : 'ops_live_20160501'
});

/**
 * Parsing time-line..[START]
 * */
let pdfToTextStream = (pdfToTextEmitter, event) => {
	return Rx.Observable.fromEvent(
					  pdfToTextEmitter,
					  event,
					   (x) => { 
							return x;
						});	
};

let pdfToTextSubscribe = (pdfToTextStreamObservable, nextEvent) => {	
	let _holdBuffer = '';
	let _pdfToTextSubscription =  pdfToTextStreamObservable.subscribe(
		(chunk) => {	
				_holdBuffer += chunk;	
				let _olaSummaryPaymentsExec = olaSummaryPayments.exec(_holdBuffer);	 
				if(_olaSummaryPaymentsExec) {							
					
					let _xtractedPiece = _olaSummaryPaymentsExec[1];				
					
					let _isNoSummary = nullableSummaryPattern.exec(_xtractedPiece);	 				
					
					_pdfToTextSubscription.unsubscribe(); // no more listening..got what we wanted...
					
					if(_isNoSummary) {
						console.log('No Payment Summary found!');
						process.exit(0);
					}else {
						nextEvent.emit('xtractd', _xtractedPiece);
					}
						
				}
		},
		(err) => {
			console.log('Error!! ' + err);
		},
		() => {
			console.log('Completed');
		});		
		return _pdfToTextSubscription;
};

let olaNeftTextStream = (olaNeftEmitter, event) => {
	return Rx.Observable.fromEvent(
					  olaNeftEmitter,
					  event,
					   (x) => { 
							return x;
						});	
};


/**
 * Parsing time-line..[END]
 * */
 
if(filePath == undefined || exportPath == undefined) {
	console.error('Error:', 'In-sufficient arguments, terminating!');
	process.exit(1);
}

if(!pdfCheck.test(filePath)) {
	console.error('Error:', 'Not a PDF file!');
	process.exit(1);
}
if(!csvCheck.test(exportPath)) {
	console.error('Error:', 'CSV file only!');
	process.exit(1);
}

Co(function *(){  
  yield fileStat(filePath);
  let _cmd = 'pdftotext';//'ls';
  let _cmd_args = ['-raw', '-nopgbrk', '-enc', 'ASCII7', filePath, '-'];// ['-lh', '/home/siddhartham/Documents/core_work/repos/Eye-of-Sauron/ola_ripper/exec2/kkadmin']; 
  let _pdftoText = Cproc.spawn(_cmd, _cmd_args);
  let _olaNeftEmitter = new EventEmitter();
  let _pdftoTextStream = pdfToTextStream(_pdftoText.stdout, 'data');
  let _pdfToTextSubscription = pdfToTextSubscribe(_pdftoTextStream, _olaNeftEmitter);     
  let _olaNeftTextStream = olaNeftTextStream(_olaNeftEmitter, 'xtractd');
  let _olaNeftPureText =  StringObservable.match(_olaNeftTextStream, olaNeftPattern);
  let _csvContent = _olaNeftPureText.map(
						  function (x, idx, obs) { 
							  let xtracted =  x.match(extractNeftPattern);
							  let iconoAmount = xtracted[5];	
							  let parts = iconoAmount.match(extractPureAmount);
							  xtracted[5] = parseFloat(parts.join(''));
							  return xtracted.slice(1,6);
						  }
					).scan(
						function(prev, curr){
							if(curr[0] == undefined){
								curr[0] = prev[0];
							}
							return curr;
						}
					).flatMap(
						function (x, idx, obs) {
							return new Promise((resolve, reject) => {
								let __carNum = x[1];
								let __dcoQ = 'SELECT dt.DriverName as DCO FROM `car_table` AS ct, `driver_table` AS dt WHERE ct.carNumber = \''+ __carNum + '\' AND ct.ownerId = dt.DriverID';
								dbConn.query(__dcoQ, function(err, rows, fields) {
								  if (err) {									  
									  reject(err);
								  }			
								  //console.log("Query: %s", __dcoQ);	
								  if(rows.length) {
									x.push(rows[0].DCO);
								  }else {
									x.push("Car/DCO not mapped in system!");
								  }
								  resolve(x);
								});			
												 
							 });  
						}
					);
					
  let _csvHeader = Rx.Observable.of(['Payment Date', 'Car Number', 'Transaction ID', 'Payment Mode', 'Amount', 'DCO']);
  
  let _csvRes = _csvHeader.merge(_csvContent);
  _csvRes.map(function (x, idx, obs) { 
				  return x.map(JSON.stringify.bind(JSON)).join(',');
			  }).reduce(
						function(prev, curr){
							return prev.concat('\n', curr);
						}
				).first(function (x, idx, obs) {
					return new Promise((resolve, reject) => {
									Fs.writeFile(exportPath, x, { encoding: 'utf8' }, function (err, res) {
													if (err) {
													  reject.log(err);
													} else {
														console.log('File written %s', exportPath);
													   resolve(res);
													}
												  });
								  });
					
					}).subscribe(
							function (x) { 
											console.log(x);
										},
							function (err) { 
											 console.log('Error: ' + err); 
											},
							function () { 
											dbConn.end(); 
										}
					);
  
  
  _pdftoText.stderr.on('data', (err) => {
		console.log('Error:...');
		console.log(err.toString());
	  });	  
  _pdftoText.on('close', (x) => {
		
	  });
  
}).catch((err)=>{
		console.error(err + '..Terminating!');
		process.exit(1);
	});

