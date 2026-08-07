angular.module('valoran', [ 'ngRoute', 'angularModalService','flash','ngAnimate','components','angular-confirm','modalCnfReutilizable','receptor-services'])
.config([ '$routeProvider', function($routeProvider) {
	$routeProvider.when('/login', {
		templateUrl : 'view/login/login.jsp'
	}).when("/sinregistro",{
		templateUrl: "view/sinregistro/ticket/ticket.jsp"
    }).when("/recuperar",{
		templateUrl: "view/sinregistro/recuperar/recuperar.jsp"
    }).otherwise({redirectTo: '/login'});
	
} ]);