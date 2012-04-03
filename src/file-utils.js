/**
 * @name FileUtils.
 * @description File and directory utilities for node.js.
 *
 * @author Gabriel Llamas
 * @created 28/03/2012
 * @modified 03/04/2012
 * @version 0.1.0
 */
"use strict";

var FS = require ("fs");
var PATH = require ("path");
var UTIL = require ("util");
var CRYPTO = require ("crypto");

var SLASH = PATH.normalize ("/");

var File = function (p){
	var main = process.mainModule.filename;
	var cwd = main.substring (0, main.lastIndexOf (SLASH));
	var relative = PATH.relative (process.cwd (), cwd);
	var path = null;
	var relativePath = null;
	var isAbsolute = false;
	
	if (p){
		p = PATH.normalize (p);
		isAbsolute = p[0] === SLASH || p.indexOf (":") !== -1;
		if (p === ("." + SLASH)){
			p = "";
		}else if (p === ".." + SLASH){
			p = "..";
		}
		path = p;
		relativePath = isAbsolute ? p : PATH.join (relative, p);
	}
	
	var me = this;
	Object.defineProperties (this, {
		"_isAbsolute": { value: isAbsolute },
		"_relative": { value: relative },
		"_path": { value: path },
		"_relativePath": { value: relativePath },
		"_removeOnExit": { value: false, writable: true },
		"_removeOnExitCallback": {
			value: function (){
				removeSynchronous (me);
			}
		}
	});
};

var checkPermission = function (file, mask, cb){
	FS.stat (file, function (error, stats){
		if (error){
			cb (error, false);
		}else{
			cb (null, !!(mask & parseInt ((stats.mode & parseInt ("777", 8)).toString (8)[0])));
		}
	});
};

var setPermission = function (file, mask, action, cb){
	FS.stat (file, function (error, stats){
		if (error){
			if (cb) cb (error, false);
		}else{
			var permissions = (stats.mode & parseInt ("777", 8)).toString (8);
			var u = parseInt (permissions[0]);
			var can = !!(u & mask);
			if ((can && !action) || (!can && action)){
				var q = action ? mask : -mask;
				FS.chmod (file, (q + u) + permissions.substring (1), function (error){
					if (cb) cb (error, !error);
				});
			}else{
				if (cb) cb (null, false);
			}
		}
	});
};

File.prototype.canExecute = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	checkPermission (this._relativePath, 1, cb);
};

File.prototype.canRead = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	checkPermission (this._relativePath, 4, cb);
};

File.prototype.canWrite = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	checkPermission (this._relativePath, 2, cb);
};

File.prototype.checksum = function (algorithm, encoding, cb){
	if (arguments.length === 2 && typeof encoding === "function"){
		cb = encoding;
		encoding = "hex";
	}
	
	if (!cb) return;
	if (!this._path) return cb (null, null);
	var me = this;
	FS.stat (this._relativePath, function (error, stats){
		if (error){
			cb (error, null);
		}else if (stats.isDirectory ()){
			cb ("The abstract path is a directory.", null);
		}else if (stats.isFile ()){
			algorithm = CRYPTO.createHash (algorithm);
			var s = FS.ReadStream (me._relativePath);
			s.on ("error", function (error){
				cb (error, null);
			});
			s.on ("data", function (data){
				algorithm.update (data);
			});
			s.on ("end", function (){
				cb (null, algorithm.digest (encoding));
			});
		}
	});
};

File.prototype.contains = function (file, cb){
	this.search (file, function (error, files){
		if (error) cb (error, false);
		else cb (null, files.length !== 0);
	});
};

File.prototype.copy = function (destination, replace, cb){
	var argsLen = arguments.length;
	if (argsLen === 1){
		replace = false;
	}else if (argsLen === 2 && typeof replace === "function"){
		cb = replace;
		replace = false;
	}

	if (!this._path){
		if (cb) cb (null, false);
		return;
	}
	
	var isAbsolute = destination instanceof File ?
		destination._isAbsolute :
		new File (destination)._isAbsolute;
	
	var stringDest = PATH.normalize (destination.toString ());
	var dest = isAbsolute ? stringDest : PATH.join (this._relative, stringDest);
	var me = this;
	var copyFile = function (){
		var s = FS.createWriteStream (dest);
		s.on ("error", function (error){
			if (cb) cb (error, false);
		});
		s.once ("open", function (fd){
			UTIL.pump (FS.createReadStream (me._relativePath), f, function (error){
				error = error === undefined ? null : error;
				if (cb) cb (error, !error);
			});
		});
	};
	var copyDirectory = function (){
		FS.mkdir (dest, function (error){
			if (error){
				if (cb) cb (error, false);
			}else{
				FS.readdir (me._relativePath, function (error, files){
					if (error){
						if (cb) cb (error, false);
					}else{
						var filesLen = files.length;
						var done = 0;
						files.forEach (function (file){
							new File (PATH.join (me._path, file))
								.copy (PATH.join (stringDest, file), function (error, copied){
									if (error){
										if (cb) cb (error, false);
									}else{
										done++;
										if (done === filesLen){
											if (cb) cb (null, true);
										}
									}
								});
						});
					}
				});
			}
		});
	};
	
	FS.stat (this._relativePath, function (error, stats){
		if (error){
			if (cb) cb (error, false);
		}else{
			PATH.exists (dest, function (exists){
				if (exists && !replace){
					if (cb) cb (null, false);
				}else{
					if (stats.isFile ()){
						copyFile ();
					}else if (stats.isDirectory ()){
						if (exists && replace){
							new File (stringDest).remove (function (error, removed){
								if (error){
									if (cb) cb (error, false);
								}else{
									copyDirectory ();
								}
							});
						}else{
							copyDirectory ();
						}
					}
				}
			});
		}
	});
};

File.prototype.createDirectory = function (cb){
	if (!this._path){
		if (cb) cb (null, false);
		return;
	}
	
	var mkdirDeep = function (path, cb){
		path.exists (function (exists){
			if (exists) return cb (null, false);
			
			path.mkdir (function (error, created){
				if (created) return cb (null, true);
				
				var parent = path.getParentFile ();
				if (parent === null) return cb (null, false);
				
				mkdirDeep (parent, function (error, created){
					if (created){
						path.mkdir (function (error, created){
							cb (error, created);
						});
					}else{
						parent.exists (function (exists){
							if (!exists) return cb (null, false);
							
							path.mkdir (function (error, created){
								cb (error, created);
							});
						});
					}
				});
			});
		});
	};
	
	mkdirDeep (this.getAbsoluteFile (), function (error, created){
		if (cb) cb (error, created);
	});
};

File.prototype.createNewFile = function (cb){
	if (!this._path){
		if (cb) cb (null, false);
		return;
	}
	
	var path = this._relativePath;
	PATH.exists (path, function (exists){
		if (exists){
			if (cb) cb (null, false);
		}else{
			var s = FS.createWriteStream (path);
			s.on ("error", function (error){
				if (cb) cb (error, false);
			});
			s.end ();
			if (cb) cb (null, true);
		}
	});
};

File.createTempFile = function (settings, cb){
	if (arguments.length === 1 && typeof settings === "function"){
		cb = settings;
	}
	
	var pre = "";
	var suf = "";
	var dir = ".";
	
	if (settings){
		pre = settings.prefix ? settings.prefix : pre;
		suf = settings.suffix ? settings.suffix : suf;
		dir = settings.directory ? settings.directory.toString () : dir;
	}
	
	var random = Math.floor (Math.random ()*1000000000000);
	var f = new File (PATH.join (dir, pre + random + suf));
	PATH.exists (f._relativePath, function (exists){
		if (exists){
			File.createTempFile (settings, cb);
		}else{
			f.removeOnExit ();
			var s = FS.createWriteStream (f._relativePath);
			s.on ("error", function (error){
				if (cb) cb (error, null);
			});
			s.end ();
			if (cb) cb (null, f);
		}
	});
}

File.prototype.equals = function (file){
	var p = (file instanceof File) ?
		file.getAbsolutePath () :
		new File (file).getAbsolutePath ();
	return p === this.getAbsolutePath ();
};

File.prototype.exists = function (cb){
	if (!cb) return;
	if (!this._path) return cb (false);
	
	PATH.exists (this._relativePath, function (exists){
		cb (exists);
	});
};

File.prototype.getAbsoluteFile = function (){
	return new File (this.getAbsolutePath ());
};

File.prototype.getAbsolutePath = function (){
	if (!this._path) return null;
	if (this._isAbsolute) return this._path;
	return PATH.join (new File (process.mainModule.filename).getParent (), this._path);
};

File.prototype.getName = function (){
	if (!this._path) return null;
	return PATH.basename (this._path);
};

File.prototype.getParent = function (){
	if (!this._path) return null;
	var index = this._path.lastIndexOf (SLASH);
	if (index === -1) return null;
	if (index === 0){
		if (this._path === SLASH) return null;
		else return "/";
	}
	return this._path.substring (0, index);
};

File.prototype.getParentFile = function (){
	var parent = this.getParent ();
	if (parent === null) return null;
	return new File (parent);
};

File.prototype.getPath = function (){
	return this._relativePath;
};

File.prototype.getPermissions = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	FS.stat (this._relativePath, function (error, stats){
		if (error){
			cb (error, false);
		}else{
			cb (null, (stats.mode & parseInt ("777", 8)).toString (8));
		}
	});
};

File.prototype.isDirectory = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	FS.stat (this._relativePath, function (error, stats){
		if (error) cb (error, false);
		else cb (null, stats.isDirectory ());
	});
};

File.prototype.isFile = function (cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	FS.stat (this._relativePath, function (error, stats){
		if (error) cb (error, false);
		else cb (null, stats.isFile ());
	});
};

File.prototype.isHidden = function (){
	throw "Not yet implemented.";
};

File.prototype.lastModified = function (cb){
	if (!cb) return;
	if (!this._path) return cb ("Null path.");
	FS.stat (this._relativePath, function (error, stats){
		if (error) cb (error);
		else cb (null, stats.mtime);
	});
};

File.prototype.list = function (filter, cb){
	var argsLen = arguments.length;
	if (argsLen === 0) return;
	if (argsLen === 1 && typeof filter === "function"){
		cb = filter;
		filter = null;
	}
	if (!cb) return;
	if (!this._path) return (null, null);
	
	var me = this;
	FS.stat (this._relativePath, function (error, stats){
		if (error){
			cb (error, null);
		}else if (stats.isFile ()){
			cb ("The path is not a directory.", null);
		}else if (stats.isDirectory ()){
			var search = function (relativeFolder, folder, holder, filter, cb){
				var applyFilter = function (files){
					var f = [];
					var file;
					files.forEach (function (file){
						if (filter (file, PATH.join (folder, file))){
							f.push (file);
						}
					});
					return f;
				};
				
				FS.readdir (relativeFolder, function (error, files){
					if (error) return cb (error, null);
					if (filter){
						files = applyFilter (files);
					}
					
					var filesLen = files.length;
					var done = 0;
					var finish = function (){
						if (done === filesLen){
							cb (null, holder);
							return true;
						}
						return false;
					};
					
					if (finish ()) return;
					files.forEach (function (file){
						var filePath = PATH.join (folder, file);
						FS.stat (PATH.join (relativeFolder, file), function (error, stats){
							if (error) return cb (error, null);
							if (stats.isFile ()){
								holder[file] = filePath;
								done++;
								finish ();
							}else if (stats.isDirectory ()){
								holder[file] = {};
								search (
									PATH.join (relativeFolder, file),
									filePath,
									holder[file],
									filter,
									function (error, files){
										if (error) return cb (error, null);
										done++;
										finish ();
									}
								);
							}
						});
					});
				});
			};
			
			search (me._relativePath, me._path, {}, filter, function (error, files){
				cb (error, files);
			});
		}
	});
};

File.prototype.listFiles = function (filter, cb){
	var argsLen = arguments.length;
	if (argsLen === 0) return;
	if (argsLen === 1 && typeof filter === "function"){
		cb = filter;
		filter = null;
	}
	if (!cb) return;
	
	var replace = function (files){
		for (var file in files){
			var path = files[file];
			if (typeof path === "string"){
				files[file] = new File (path);
			}else{
				replace (path);
			}
		}
	};
	
	this.list (filter, function (error, files){
		if (error){
			cb (error, null);
		}else{
			replace (files);
			cb (null, files);
		}
	});
};

File.prototype.rename = function (file, replace, cb){
	var argsLen = arguments.length;
	if (argsLen === 1){
		replace = false;
	}else if (argsLen === 2 && typeof replace === "function"){
		cb = replace;
		replace = false;
	}
	
	if (!this._path){
		if (cb) cb (null, false);
		return;
	}
	
	var isAbsolute = file instanceof File ?
		file._isAbsolute :
		new File (file)._isAbsolute;
	
	var stringDest = PATH.normalize (file.toString ());
	var renamedFile = isAbsolute ? stringDest : PATH.join (this._relative, stringDest);
	if (replace){
		FS.rename (this._relativePath, renamedFile, function (error){
			if (cb) cb (error, !error);
		});
	}else{
		var me = this;
		PATH.exists (renamedFile, function (exists){
			if (exists){
				if (cb) cb (null, false);
			}else{
				FS.rename (me._relativePath, renamedFile, function (error){
					if (cb) cb (error, !error);
				});
			}
		});
	}
};

File.prototype.remove = function (cb){
	if (!this._path){
		if (cb) cb (null, false);
		return;
	}
	
	var me = this;
	FS.stat (this._relativePath, function (error, stats){
		if (error){
			if (cb) cb (error, false);
			return;
		}
		
		if (stats.isFile ()){
			FS.unlink (me._relativePath, function (error){
				if (cb){
					if (error) cb (error, false);
					else cb (null, true);
				}
			});
		}else if (stats.isDirectory ()){
			FS.readdir (me._relativePath, function (error, files){
				if (error){
					if (cb) cb (error, false);
					return;
				}
				
				var filesLen = files.length;
				var done = 0;
				var finish = function (){
					if (filesLen === done){
						FS.rmdir (me._relativePath, function (error){
							if (cb){
								if (error) cb (error, false);
								else cb (null, true);
							}
						});
						return true;
					}
					return false;
				};
				
				if (!finish ()){
					for (var i in files){
						new File (PATH.join (me._path, files[i])).remove (function (error, removed){
							if (error){
								if (cb) cb (error, false);
							}else{
								done++;
								finish ();
							}
						});
					}
				}
			});
		}
	});
};

var removeSynchronous = function (file){
	if (!file._path) return false;
	if (!PATH.existsSync (file._relativePath)) return false;
	
	var stats = FS.statSync (file._relativePath);
	if (stats.isFile ()){
		FS.unlinkSync (file._relativePath);
	}else if (stats.isDirectory ()){
		var files = FS.readdirSync (file._relativePath);
		for (var i in files){
			removeSynchronous (new File (PATH.join (file._path, files[i])));
		}
		FS.rmdirSync (file._relativePath);
	}
	
	return true;
};

File.prototype.removeOnExit = function (remove){
	remove = remove !== undefined ? remove : true;
	if (!this._removeOnExit && remove){
		this._removeOnExit = remove;
		process.on ("exit", this._removeOnExitCallback);
	}else if (this._removeOnExit && !remove){
		this._removeOnExit = remove;
		process.removeListener ("exit", this._removeOnExitCallback);
	}
};

File.prototype.search = function (file, cb){
	if (!cb) return;
	if (!this._path) return cb (null, false);
	
	file = file instanceof File ? file.getName () : file;
	var files = [];
	
	this.list (function (name, path){
		if (name === file){
			files.push (path);
		}
		return true;
	}, function (error){
		if (error) cb (error, null);
		else cb (null, files);
	});
};

File.prototype.setExecutable = function (executable, cb){
	if (!this._path) return cb (null, false);
	setPermission (this._relativePath, 1, executable, cb);
};

File.prototype.setPermissions = function (permissions, cb){
	if (!this._path) return cb (null, false);
	FS.chmod (this._relativePath, permissions, function (error){
		if (cb) cb (error, !error);
	});
};

File.prototype.setReadable = function (readable, cb){
	if (!this._path) return cb (null, false);
	setPermission (this._relativePath, 4, readable, cb);
};

File.prototype.setReadOnly = function (cb){
	FS.chmod (this._relativePath, "444", function (error){
		cb (error, !error);
	});
};

File.prototype.setWritable = function (writable, cb){
	if (!this._path) return cb (null, false);
	setPermission (this._relativePath, 2, writable, cb);
};

File.prototype.size = function (cb){
	if (!cb) return;
	if (!this._path) return cb ("Null path.", null);
	FS.stat (this._relativePath, function (error, stats){
		if (error) cb (error, null);
		else cb (null, stats.size);
	});
};

File.prototype.toString = function (){
	return this._relativePath;
};

module.exports.File = File;