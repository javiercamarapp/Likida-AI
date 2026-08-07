angular.module('valoran').controller('facturacionSinRegistroController', ['$scope', '$http', 'Flash', 'ticketFactory', 'ModalService', 'globalMensajes', 'globalIndex', 'validacionesFactory', 'utileriasFactory', '$confirm', 'serviciosReceptor',
	function($scope, $http, Flash, ticketFactory, ModalService, globalMensajes, globalIndex, validacionesFactory, utileriasFactory, $confirm, serviciosReceptor) {

		$scope.instanciaQr = null;

		$scope.getInstanciaQr = function() {
			return $scope.instanciaQr;
		}
		$scope.setInstanciaQr = function(instancia) {
			$scope.instanciaQr = instancia;
		}

		$scope.activarQr = function() {
			if ($scope.getInstanciaQr()._active) {
				$scope.getInstanciaQr().stop();
			} else {
				$scope.getInstanciaQr().start();
			}
		};

		$scope.setResultadoQr = function(result) {
			$scope.validarcadena18(result.data);
		};

		$scope.receptor = {};
		$scope.mensaje = "Captura de Datos Fiscales";
		$scope.steps = ['one', 'two', 'three'];
		$scope.step = 0;
		$scope.codigo16 = "";
		$scope.tickets = {};
		$scope.banderaQR = false;
		$scope.mensajeBotonQr = "Escanear C\u00f3digos QR";
		$scope.Complemento_Ine = {};
		$scope.partidoPolitico = false;
		$scope.dividirCodigos = false;
		$scope.listadoUsoCFDI = [];
		$scope.usocfdi = {};
		$scope.mensajeError = {};
		$scope.entidadIdContabilidad = {};

		$scope.listaProceso = [];
		$scope.listaAmbito = [];
		$scope.listaProceso = [];
		$scope.listaComite = [];
		$scope.listaClaveEntidad = [];

		setTimeout(function() {
			evaluadorPasos(0, "inicio");
		}, 200);
		getTickets();
		function getTickets() {
			$http.post('ticket/buscarSinRegistro.json').success(function(data, status, headers, config) {
				$scope.tickets = data;
			}).error(function(data, status, headers, config) { });
		}
		;

		function reinicioCajas() {
			$('#codigo18').val("");
			$('#codigo16').val("");
			$scope.fechasArray = [];
		}
		;

		function modalError() {
			window.scrollTo(0, 0);
			$('#modalError').modal();
		}
		;
		$scope.cerraModal = function() {
			$('#modalError').modal('hide');
		};

		$scope.isFirstStep = function() {
			return $scope.step === 0;
		};

		$scope.isLastStep = function() {
			return $scope.step === ($scope.steps.length - 1);
		};

		$scope.isCurrentStep = function(step) {
			return $scope.step === step;
		};

		$scope.setCurrentStep = function(step) {
			$scope.step = step;
		};

		$scope.getCurrentStep = function() {
			return $scope.steps[$scope.step];
		};

		$scope.getNextLabel = function() {
			return ($scope.isLastStep()) ? 'Facturar' : 'Siguiente';
		};

		$scope.handlePrevious = function() {
			$scope.step -= ($scope.isFirstStep()) ? 0 : 1;
			evaluadorPasos($scope.step, "atras");
			validarMostrarPartidoPolitico();
		};

		$scope.handleNext = function() {
			$scope.banderaQR = false;
			if ($scope.step == 0) {
				serviciosReceptor.validarReceptor40($scope.receptor).then(function(response) {
					if (response.error) {
						var messageError = `<strong>ERROR !</strong>${response.mensaje}`;
						Flash.create('danger', messageError, 'customAlertError');
						$scope.step = 0;
					} else {
						$http.post("receptor/guardaReceptorSinRegistro.json", $scope.receptor);
						$scope.step += 1;
					}
				});
			} else if ($scope.isLastStep()) {
				
			} else {
				$scope.step += 1;
			}
			evaluadorPasos($scope.step, "adelante");
			validarMostrarPartidoPolitico();
		};


		function validarMostrarPartidoPolitico() {
			if ($scope.partidoPolitico) {
				$("#partidoPolitico").attr('checked', true);
			}
		}

		function evaluadorPasos(paso, direccion) {
			switch (paso) {
				case 0:
					$("#paso1").addClass("completed");
					$("#paso2").removeClass("completed");
					$("#paso3").removeClass("completed");
					$("#final").removeClass("success");
					break;
				case 1:
					$("#paso2").addClass("completed");
					$("#paso3").removeClass("completed");
					$("#final").removeClass("success");
					break;
				case 2:
					$("#paso3").addClass("completed");
					$("#final").addClass("success");
					break;
				default:
					break;
			}
		}
		;

		$scope.tamanioTickets = function() {
			if ($scope.tickets.length > 0) {
				return false;
			} else {
				return true;
			}
		};

		$scope.buscarReceptorRfc = function(result) {
			if ($scope.receptor.rfc === 'MTA900528FIA') {
				var messageError = "<strong>ERROR !</strong> El rfc MTA900528FIA no puede ser un receptor para facturas";
				Flash.create('danger', messageError, 'customAlertError');
				$scope.receptor = {};
			}

		};

		$scope.listadoRegimenFiscal = [];
		$scope.buscarRegimenFiscalRfc = function() {
			if (undefined !== $scope.receptor.rfc && ($scope.receptor.rfc.length === 12 || $scope.receptor.rfc.length === 13)) {
				serviciosReceptor.buscarRegimenFiscalesRfc($scope.receptor.rfc).then(function(value) {
					$scope.receptor.regimenFiscalReceptor = null;
					$scope.listadoRegimenFiscal = value
				}, function(reason) {
					console.log("buscarRegimenFiscalesRfc reason:", reason);
				}, function(value) {
					console.log("buscarRegimenFiscalesRfc value2:", value);
				});
			}
		};

		$scope.buscarUsosCfdiPorRfc = function() {
			if (undefined !== $scope.receptor.rfc && ($scope.receptor.rfc.length === 12 || $scope.receptor.rfc.length === 13)) {
				$http.post("usocfdi40/obtener_usoscfdi_por_rfc.json", { rfc: $scope.receptor.rfc, regimenFiscal: $scope.receptor.regimenFiscalReceptor }).success(function(data, status, headers, config) {
					$scope.receptor.usoCfdi = null;
					$scope.listadoUsoCFDI = data;
				}).error(function(data, status, headers, config) {

				});
			}
		};

		$scope.formatearCodigo9 = function(value) {
			if (value != null) {
				var cadenaInteligente = value.replace(/-/g, "");
				var cadenaFormateada = "";
				for (var i = 0; i < cadenaInteligente.length; i++) {
					cadenaFormateada += cadenaInteligente.charAt(i);
					if ((cadenaFormateada.length + 1) % 4 == 0)
						cadenaFormateada += "-";
				}
				if (cadenaFormateada.length > 11) {
					cadenaFormateada = $scope.eliminarUltimo(cadenaFormateada);
				}
				$('#codigo18').val(cadenaFormateada);

			}
		};

		$scope.eliminarUltimo = function(value) {
			var lastChar = value.substr(value.length - 1);
			if (lastChar === '-') {
				return value.substring(0, value.length - 1);
			} else {
				return value;
			}
		}

		$scope.reinicar = function() {
			$('#codigo18').val("");
			$('#codigo16').val("");
		};

		function validarResultado(data) {
			if (data.codigo == "ERROR") {
				if (data.opcion.indexOf("-") != -1) {
					$scope.fechaCorrectaDisabled = true;
					var arreglorespuesta = data.opcion.split("-");
					var cadena = arreglorespuesta[0];
					var mes = arreglorespuesta[1];
					$scope.cadenaEnvio = cadena;
					$scope.cadenaAnterior = arreglorespuesta[2];
					$("#modalTicketFecha").modal();
					$(".fechaCorrecta").removeAttr("checked");
					$("input:radio").removeAttr("checked");
				} else {
					getTickets();
					var messageError = "<strong>ERROR !</strong> " + data.opcion;
					Flash.create('info', messageError, 'customAlertError');
				}
			} else {
				var message = "<strong>\u00c9xito !</strong> C\u00f3digo verificado y capturado con \u00c9xito";
				Flash.create('info', message, 'customAlertSuccces');
				getTickets();
			}
		}
		;

		function validaResultadoEmergencia(data) {
			$scope.ticketE = data;
			$("#modalTicketFormaPago").modal();
		}

		$scope.validarcadena18 = function(result) {
			var valor = $('#codigo18').val();
			if (undefined != result)
				valor = result;
			var valorsend = valor.replace(/-/g, "");
			reinicioCajas();
			$http.post("ticket/guardarSinRegistro.json", {
				codigo: valorsend
			}).success(function(data, status, headers, config) {
				if (data !== null) {
					validarResultado(data);
				} else {
					globalMensajes.getMensajeErrorTarde();
				}
			}).error(function(data, status, headers, config) {
				if (status == 401) {
					globalIndex.getIndexLogin();
				} else {
					globalMensajes.getMensajeErrorTarde();
				}
			});
		};

		$scope.borrarTicket = function(ticketObject) {
			$confirm({
				text: 'Esta usted seguro de eliminar este c\u00f3digo',
				title: 'Confirmaci\u00f3n de datos',
				ok: 'Aceptar',
				cancel: 'Cancelar'
			})
				.then(function() {
					ticketFactory.deleteTicket(ticketObject).success(function(data, status, headers, config) {
						var message = "<strong>\u00c9xito !</strong> C\u00f3digo eliminado";
						Flash.create('info', message, 'customAlertSuccces');
						getTickets();
					}).error(function(data, status, headers, config) {
						getTickets();
						if (status == 401) {
							globalIndex.getIndexLogin();
						} else {
							globalMensajes.getMensajeErrorTarde();
						}
					});
				});
		};

		var hasOwnProperty = Object.prototype.hasOwnProperty;
		function isEmpty(obj) {

			// null and undefined are "empty"
			if (obj == null) return true;

			// Assume if it has a length property with a non-zero value
			// that that property is correct.
			if (obj.length > 0) return false;
			if (obj.length === 0) return true;

			// Otherwise, does it have any properties of its own?
			// Note that this doesn't handle
			// toString and valueOf enumeration bugs in IE < 9
			for (var key in obj) {
				if (hasOwnProperty.call(obj, key)) return false;
			}

			return true;
		}

		$scope.facturar = function() {
			//getTickets();
			$confirm({
				cancel: 'Cancelar',
				ok: 'Aceptar',
				text: '\u00bfEst\u00e1 usted seguro de que esta informaci\u00f3n es correcta?, clic en Aceptar para iniciar el proceso de facturaci\u00f3n, de lo contrario dar clic en Cancelar, posteriormente navegar en el bot\u00f3n Anterior en caso de cambiar alg\u00fan valor.',
				title: 'Confirmaci\u00f3n de datos'
			})
				.then(function() {
					$confirm({
						cancel: 'Cancelar',
						ok: 'Aceptar',
						text: 'Una vez emitida la factura no se podr\u00e1 remitir a un RFC diferente ni corregir datos',
						title: 'Aviso'
					})
						.then(function() {
							var complementoIne = null;
							var entidad = null;
							if ($scope.Complemento_Ine != null && $scope.Complemento_Ine != undefined && !isEmpty($scope.Complemento_Ine)) {
								complementoIne = angular.copy($scope.Complemento_Ine);
								entidad = angular.copy($scope.Complemento_Ine.entidad);
								complementoIne.version = "1.1";
								complementoIne.entidad = [];
								complementoIne.entidad.push(entidad);
								if ($scope.entidadIdContabilidad.id != null && $scope.entidadIdContabilidad.id != undefined) {
									complementoIne.entidad[0].contabilidad = [];
									var variableIdEntidad = {
										idContabilidad: $scope.entidadIdContabilidad.id
									};
									complementoIne.entidad[0].contabilidad.push(variableIdEntidad);
								}
							}

							$http.post("ticket/facturarSinRegistro.json", {
								receptor: $scope.receptor,
								complemento_Ine: complementoIne,
								dividirCodigos: $scope.dividirCodigos
							}).success(function(data, status, headers, config) {
								getTickets();
								if (data != null) {
									if (data[0].uuid != null) {
										mostrarModal(data);
									} else {
										$scope.mensajeError = data[0].opcion;
										modalError();
										globalMensajes.getMensajeErrorTarde();
									}
								} else {
									globalMensajes.getMensajeErrorTarde();
								}
							}).error(function(data, status, headers, config) {
								getTickets();
								if (status == 401) {
									globalIndex.getIndexLogin();
								} else {
									globalMensajes.getMensajeErrorTarde();
								}

							});

						});
				});
		};

		function mostrarModal(value) {
			$scope.resultadoWrappers = value;
			$("#modalReutilizableT").modal();
		}
		;
		$scope.idModalT = "modalReutilizableT";
		$scope.headerModalT = "Facturas creadas con \u00e9xito";

		$scope.showCanvasQR = function() {
			if (null === $scope.getInstanciaQr()) {				
				var video = document.createElement("video");
				video.setAttribute("id", "qr-video");
				video.setAttribute("width", "300");
				video.setAttribute("height", "200");
				var elementoContenedor = document.getElementById("contenedorVideo");
				elementoContenedor.appendChild(video);
								
				let qrScanner = new QrScanner(
					video,
					result => $scope.setResultadoQr(result),
					{
						highlightScanRegion: true,
						highlightCodeOutline: true,
					},
				);
				console.log("qrScanner:", qrScanner);
				$scope.setInstanciaQr(qrScanner);
			}
						
			if ($scope.getInstanciaQr()._active) {
				$scope.getInstanciaQr().stop();
				$scope.setInstanciaQr(null);
				document.getElementById("qr-video").remove();
			} else {
				$scope.getInstanciaQr().start();
			}
		};

		$scope.mostrarMod = function() {
			$("#modalReutilizableT").modal();
		};

		$http.post("utilerias/tiposProceso.json").success(function(data, status, headers, config) {
			$scope.listaProceso = data;
		}).error(function(data, status, headers, config) { });

		$http.post("utilerias/tiposComite.json").success(function(data, status, headers, config) {
			$scope.listaComite = data;
		}).error(function(data, status, headers, config) { });

		$http.post("utilerias/tiposAmbito.json").success(function(data, status, headers, config) {
			$scope.listaAmbito = data;
		}).error(function(data, status, headers, config) { });

		$http.post("utilerias/clavesEntidad.json").success(function(data, status, headers, config) {
			$scope.listaClaveEntidad = data;
		}).error(function(data, status, headers, config) { });

		utileriasFactory.getMetododePago(0).success(function(data) {
			$scope.metodoPagos = data;
		});

		$scope.mostrarModalPartidoPolitico = function(value) {
			$scope.Complemento_Ine = {};
			$scope.desactivaEntidad = false;
			$scope.desactivaTipoComite = false;
			$scope.desactivaAmbito = false;
			$scope.desactivaIdContabilidad = false;
			$scope.partidoPolitico = value;
		};

		$scope.validarTipoProceso = function(value) {
			if (value == "Ordinario") {
				$scope.desactivaTipoComite = false;
				$scope.requiredEntidad = false;
				$scope.requiredAmbito = false;
				$scope.desactivaAmbito = false;
			} else if (value == "Precampa\u00F1a" || value == "Campa\u00F1a") {
				delete $scope.Complemento_Ine.tipoComite;
				$scope.desactivaTipoComite = true;
				$scope.requiredEntidad = true;
				$scope.requiredAmbito = true;
				$scope.desactivaAmbito = false;
				$scope.desactivaEntidad = false;
				$scope.desactivaIdContabilidad = true;
				delete $scope.Complemento_Ine.idContabilidad;
			}

		};

		$scope.validarComite = function(value) {
			if (value == "Ejecutivo Nacional") {
				$scope.desactivaEntidad = true;
				$scope.desactivaAmbito = true;
				delete $scope.Complemento_Ine.entidad;
				$scope.desactivaIdContabilidad = false;
				delete $scope.entidadIdContabilidad.id;
			} else if (value == "Ejecutivo Estatal") {
				$scope.desactivaIdContabilidad = true;
				$scope.desactivaEntidad = false;
				$scope.desactivaAmbito = true;
			} else {
				delete $scope.Complemento_Ine.idContabilidad;
				delete $scope.Complemento_Ine.entidad;
				$scope.desactivaEntidad = false;
				$scope.desactivaAmbito = true;
				$scope.desactivaIdContabilidad = true;
				delete $scope.Complemento_Ine.idContabilidad;
			}
		};

		$scope.aceptaDividir = function(value) {
			$scope.dividirCodigos = value;
		};

		$scope.onSuccessQr = function(data) {
			$scope.validarcadena18(data);
		};

		function buscarObjetoEnArregloPorPropiedad(array, key, value) {
			for (var i = 0; i < array.length; i++) {
				if (array[i][key] === value) {
					return array[i];
				}
			}
			return null;
		}
		;

	}]);