"use strict";

let Rx = require('rxjs');

let match = (observable, regex) => {
	
    return Rx.Observable.create((observer) => {
		
      let leftOver = '';

      function onNext(segment) {		
        const parts = segment.match(regex);
        parts[0] = leftOver + parts[0];
        leftOver = parts.pop();	  
        parts.forEach(part => observer.next(part));
        observer.next(leftOver);
        observer.complete();
      }

      function onError(err) {
        observer.next(leftOver);
        observer.error(err);
      }

      function onCompleted() {
        observer.next(leftOver);
        observer.complete();
      }

      observable.subscribe(onNext, onError, onCompleted);
    });
  };
  
module.exports.match = match;
