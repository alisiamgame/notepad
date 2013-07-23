
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , connect = require('connect')
  , jade = require('jade')
  , mongoose = require('mongoose')
  , mongoStore = require('connect-mongodb')
  , mailer = require('mailer')
  , stylus = require('stylus')
  , connectTimeout = require('connect-timeout')
  , models = require('./models')
  //, flash = require('connect-flash')
  , db
  , Document
  , User
  , LoginToken
  , emails;

var app = express();

 
function renderJadeFile(template, options) {
  var fn = jade.compile(template, options);
  return fn(options.locals);
}

emails = {
  send: function(template, mailOptions, templateOptions) {
    mailOptions.to = mailOptions.to;
    renderJadeFile(path.join(__dirname, 'views', 'mailer', template), templateOptions, function(err, text) {
      // Add the rendered Jade template to the mailOptions
      mailOptions.body = text;

      // Merge the app's mail options
      var keys = Object.keys(app.set('mailOptions')),
          k;
      for (var i = 0, len = keys.length; i < len; i++) {
        k = keys[i];
        if (!mailOptions.hasOwnProperty(k))
          mailOptions[k] = app.set('mailOptions')[k];
      }

      console.log('[SENDING MAIL]', util.inspect(mailOptions));

      // Only send mails in production
      if (app.settings.env == 'production') {
        mailer.send(mailOptions,
          function(err, result) {
            if (err) {
              console.log(err);
            }
          }
        );
      }
    });
  },

  sendWelcome: function(user) {
    this.send('welcome.jade', { to: user.email, subject: 'Welcome to Nodepad' }, { locals: { user: user } });
  }
};

//app.helpers(require('./helpers.js').helpers);
app.locals = require('./helpers.js').helpers;
app.locals.pretty = true;

//development only
if ('development' == app.get('env')) {
	console.log('env');
	app.set('db-uri', 'mongodb://localhost/notepad-development');
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
}

models.defineModels(mongoose, function() {
	app.Document = Document = mongoose.model('Document');
	app.User = User = mongoose.model('User');
	app.LoginToken = LoginToken = mongoose.model('LoginToken');
	
	//console.log(app.get('db-uri'));
	//console.log(LoginToken);
	
	db = mongoose.connect(app.set('db-uri'));
});
	
// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(connectTimeout({ time: 10000 }));
app.use(express.session({ secret: 'secret' }));
app.use(express.methodOverride());
app.use(stylus.middleware({ src: __dirname + '/public' }));
app.use(function(req, res, next){
	res.locals.messages = req.session.messages;
	next();
});
app.use(function(req, res, next){
	var session = req.session;
	var messages = session.messages || (session.messages = []);
	
	req.flash = function(type, message) {
		messages.push([type, message]);
	};
	next();
});
app.use(app.router);
app.set('mailOptions', {
    host: 'localhost',
    port: '25',
    from: 'nodepad@example.com'
  });
app.use(express.static(path.join(__dirname, 'public')));


function authenticateFromLoginToken(req, res, next) {
	console.log('authenticateFromLoginToken');
	
  var cookie = JSON.parse(req.cookies.logintoken);

  LoginToken.findOne({ email: cookie.email,
                       series: cookie.series,
                       token: cookie.token }, (function(err, token) {
    if (!token) {
      res.redirect('/sessions/new');
      return;
    }

    User.findOne({ email: token.email }, function(err, user) {
      if (user) {
        req.session.user_id = user.id;
        req.currentUser = user;

        token.token = token.randomToken();
        token.save(function() {
          res.cookie('logintoken', token.cookieValue, { expires: new Date(Date.now() + 2 * 604800000), path: '/' });
          next();
        });
      } else {
        res.redirect('/sessions/new');
      }
    });
  }));
}

function loadUser(req, res, next) {
	console.log('loadUser');
	
	if(req.session.user_id){
		User.findById(req.session.user_id, function(err, user) {
			if(user){
				req.currentUser = user;
				next();
			} else{
				res.redirect('/sessions/new');
			}
		});
	} else if(req.cookies.logintoken) {
		authenticateFromLoginToken(req, res, next);		
	} else {
		res.redirect('/sessions/new');
	}
}

app.get('/', loadUser, function(req, res){
	console.log('get');
	res.redirect('/documents');
});

//Error handling
function NotFound(msg) {
  this.name = 'NotFound';
  Error.call(this, msg);
  Error.captureStackTrace(this, arguments.callee);
}

util.inherits(NotFound, Error);

app.get('/404', function(req, res) {
	throw new NotFound;
});

app.get('/500', function(req, res) {
	throw new Error('An expected error');
});

app.get('/bad', function(req, res) {
	unknownMethod();
});
/*
app.error(function(err, req, res, next) {
	if (err instanceof NotFound) {
		res.render('404.jade', { status: 404 });
	} else {
		next(err);
	}
});

if (app.settings.env == 'production') {
	app.error(function(err, req, res) {
		res.render('500.jade', {
			status: 500,
				locals: {
					error: err
				} 
		});
	});
}
*/
// Document list
app.get('/documents', loadUser, function(req, res){
	console.log('get documents');
	Document.find({ 'user_id': req.currentUser.id }, '', { sort: ['title', 'descending'] }, function(err, documents) {
		documents = documents.map(function(d) {
			return { title: d.title, id: d._id };
		});
		
		res.locals = { documents: documents, currentUser: req.currentUser };
		console.log(req.flash());
		res.render('documents/index.jade', { message: req.flash('info') });
	});
});

app.get('/documents/new', loadUser, function(req, res) {
	console.log('get documents-new');
	
	res.locals = { d: new Document(), currentUser: req.currentUser };
	res.render('documents/new.jade');
});

app.post('/documents.:format?', loadUser, function(req, res) {
	var d = new Document(req.body);
	//console.log(d);
	d.user_id = req.currentUser.id;
	d.save(function() {
		req.session.messages = 'Document created';
		switch (req.params.format) {
			case 'json':
				var data = d.toObject();
				data.id = data._id;
				//console.log(data);
				res.send(data);
				break;
				
			default:
				req.flash('info', 'Document created');
				console.log(d._id);
				res.redirect('/documents/' + d._id + '.' + req.params.format);
		}
	});
});

//Read document
app.get('/documents/:id.:format?', loadUser, function(req, res, next) {
	Document.findOne({ _id: req.params.id, user_id: req.currentUser.id }, function(err, d) {
		if (!d) return next(new NotFound('Document not found'));

		switch (req.params.format) {
			case 'json':
				res.send(d.toObject());
				break;

			case 'html':
				res.send(markdown.toHTML(d.data));
				break;

			default:
				res.locals = { d: d, currentUser: req.currentUser };
				res.render('documents/show.jade');
		}
	});
});

app.put('/documents/:id.:format?', loadUser, function(req, res, next) {
	console.log('put documents-id.:format');
	
	Document.findOne({ _id: req.params.id, user_id: req.currentUser.id }, function(err, d) {
		if (!d) return next(new NotFound('Document not found'));
		d.title = req.body.title;
		d.data = req.body.data;

		d.save(function(err) {
			switch (req.params.format) {
				case 'json':
					res.send(d.toObject());
					break;

				default:
					req.flash('info', 'Document updated');
					res.redirect('/documents');
			}
		});
	});
});

app.del('/documents/:id.:format?', loadUser, function(req, res, next) {
	Document.findOne({ _id: req.params.id, user_id: req.currentUser.id }, function(err, d) {
		if (!d) return next(new NotFound('Document not found'));
		
		d.remove(function() {
			switch (req.params.format) {
			case 'json':
				res.send('true');
				break;
				
			default:
				req.flash('info', 'Document deleted');
				res.redirect('/documents');
			}
		});
	});
});

app.get('/users/new', function(req, res){
	//console.log('get users-new');
	
	res.locals.user = new User();
	res.render('users/new.jade');
});

app.post('/users.:format?', function(req, res){
	//console.log('post users');
	var user = new User(req.body.user);
	
	function userSaveFailed() {
		console.log('userSaveFailed');
		req.flash('error', 'Account creation failed');
		res.locals.user = user;
		res.render('users/new.jade');
	}
	
	user.save(function(err) {
		console.log(err);
		if(err) return userSaveFailed();
		
		console.log('created');
		req.flash('info', 'Your account has been created');
		emails.sendWelcome(user);
		
		switch(req.params.format) {
			case 'json':
				res.send(user.toObject());
				console.log('json');
				break;
			default:
				console.log('default');
				req.session.user_id = user.id;
				res.redirect('/documents');
		}
	});
});

app.get('/sessions/new', function(req, res){
	console.log('get sessions-new');
	
	res.locals.user = new User();
	res.render('sessions/new.jade');
});

app.post('/sessions', function(req, res){
  console.log('post sessions');
  
  User.findOne({ email: req.body.user.email }, function(err, user) {
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user.id;

      // Remember me
      if (req.body.remember_me) {
        var loginToken = new LoginToken({ email: user.email });
        loginToken.save(function() {
          res.cookie('logintoken', loginToken.cookieValue, { expires: new Date(Date.now() + 2 * 604800000), path: '/' });
          res.redirect('/documents');
        });
      } else {
        res.redirect('/documents');
      }
    } else {
      req.flash('error', 'Incorrect credentials');
      res.redirect('/sessions/new');
    }
  }); 
});

app.del('/sessions', loadUser, function(req, res) {
	if (req.session) {
		LoginToken.remove({ email: req.currentUser.email }, function() {});
		res.clearCookie('logintoken');
		req.session.destroy(function() {});
	}
	res.redirect('/sessions/new');
});

//Search
app.post('/search.:format?', loadUser, function(req, res) {
	Document.find({ user_id: req.currentUser.id, keywords: req.body.s },
			function(err, documents) {
				console.log(documents);
				console.log(err);
				switch (req.params.format) {
					case 'json':
						res.send(documents.map(function(d) {
							return { title: d.title, id: d._id };
						}));
						break;

					default:
						res.send('Format not available', 400);
						break;
				}
			});
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
  console.log('Using connect %s, Express %s, Jade %s', connect.version, express.version, jade.version);
});
