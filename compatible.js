var rewire = require('rewire');
var cache = {};
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var AKOStream = require('AKOStream');

function comp(mod, context) {
	var bone = require('bone');
	if(!cache[mod]) {	
		context || (context = {});

		var bonefileStat = null;
		var bonebaseStat = null;

		var module = cache[mod] = rewire(mod);
		var bonefs = _.clone(fs);
		bonefs.readFile = function(file, encoding, callback) {
			if(bone.fs.exists(file, {notFs: true})) {
				AKOStream.aggreStream(bone.fs.createReadStream(file, encoding)).on('data', function(buffer) {
					callback(null, buffer);
				});
			} else {
				fs.readFile(file, encoding, callback);
			}
		};
		bonefs.createReadStream = function() {
			var args = _.toArray(arguments);
			return bone.fs.createReadStream.call(bone.fs, args);
		};
		bonefs.readdir = function(p, callback) {
			var result = bone.fs.search(path.join(p, '*'));
			var result = result.map(function(file) {
				return path.relative(p, file);
			});
			callback(null, result);
		};
		bonefs.stat = function(file, callback) {
			var isFile = bone.fs.exists(file, {notFs: true});
			var isDir = bone.fs.search(file, {notFs: true}).length > 0;
			var args = _.toArray(arguments);
			var dir = isFile ? path.dirname(file) : file;

			if(isFile) {
				if(!bonefileStat) {
					fs.stat(path.join(bone.fs.base, 'bonefile.js'), function(err, stat) {
						bonefileStat = stat;
						bonefs.stat(file, callback);
					});
				} else {
					callback(null, bonefileStat);
				}
			} else if(isDir) {
				if(!bonebaseStat) {
					fs.stat(bone.fs.base, function(err, stat) {
						bonebaseStat = stat;
						bonefs.stat(file, callback);
					});
				} else {
					callback(null, bonebaseStat);
				}
			} else {
				fs.stat.apply(fs, args);
			}
		};
		context = _.extend({}, context, {
			fs: bonefs
		});
		module.__set__(context);
	}

	return cache[mod];
}

module.exports = comp;