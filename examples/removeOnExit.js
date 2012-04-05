var File = require ("../build/file-utils").File;

var f = new File ("temp");
f.removeOnExit ();
f.createNewFile ();