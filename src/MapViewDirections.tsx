import React, { useEffect } from 'react';
import { Polyline, MapPolylineProps } from 'react-native-maps';

const WAYPOINT_LIMIT = 10;

type Marker = {
	latitude: number,
	longitude: number,
}

type Route = {
	waypoints: Marker[],
	origin: Marker,
	destination: Marker,
}

type Result = {
	coordinates: Marker[],
	distance: number,
	duration: number,
	fares: any[],
	legs: any[],
	waypointOrder: number[],
}

interface MapDirectionsProps {
	origin: Marker,
	destination: Marker,
	apikey: string, region?: string, waypoints?: Marker[],
	onStart?: (origin: string, destination: string, waypoints: string) => void,
	onReady?: (result: Result) => void, onError?: (error: string) => void,
	filterRoute?: (result: any) => number,
	mode?: string, language?: string,
	optimizeWaypoints?: boolean, splitWaypoints?: boolean,
	directionsServiceBaseUrl?: string,
	precision?: 'low' | 'high', timePrecision?: string, channel?: string,
	avoidTolls?: boolean, avoidHighways?: boolean, avoidFerries?: boolean,
}

export default function MapDirections({
	origin, destination, apikey, waypoints,
	onStart, onReady, onError, filterRoute,
	mode = 'DRIVING', language = 'en', region = '',
	optimizeWaypoints = false, splitWaypoints = false,
	directionsServiceBaseUrl = 'https://maps.googleapis.com/maps/api/directions/json',
	precision = 'low', timePrecision = 'none', channel,
	avoidTolls = false, avoidHighways = false, avoidFerries = false,
	...props }: MapDirectionsProps & Omit<MapPolylineProps, 'coordinates'>) {
	const [coordinates, setCoordinates] = React.useState(null);
	const [distance, setDistance] = React.useState(null);
	const [duration, setDuration] = React.useState(null);

	useEffect(() => {
		if (origin.latitude && origin.longitude && destination.latitude && destination.longitude && apikey) {
			fetchAndRenderRoute();
		}
	}, [
		origin, destination, apikey, waypoints,
		onStart, onReady, onError,
		mode, language, optimizeWaypoints, splitWaypoints,
		directionsServiceBaseUrl, region, precision, timePrecision,
		avoidTolls, avoidHighways, avoidFerries,
	])

	const resetState = () => {
		setCoordinates(null);
		setDistance(null);
		setDuration(null);
	}

	const decode = (t) => {
		let points: Marker[] = [];
		for (let step of t) {
			let encoded = step.polyline.points;
			let index = 0, len = encoded.length;
			let lat = 0, lng = 0;
			while (index < len) {
				let b, shift = 0, result = 0;
				do {
					b = encoded.charAt(index++).charCodeAt(0) - 63;
					result |= (b & 0x1f) << shift;
					shift += 5;
				} while (b >= 0x20);

				let dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
				lat += dlat;
				shift = 0;
				result = 0;
				do {
					b = encoded.charAt(index++).charCodeAt(0) - 63;
					result |= (b & 0x1f) << shift;
					shift += 5;
				} while (b >= 0x20);
				let dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
				lng += dlng;

				points.push({ latitude: (lat / 1E5), longitude: (lng / 1E5) });
			}
		}
		return points;
	}

	const fetchAndRenderRoute = () => {

		if (!apikey) {
			console.warn(`MapDirections Error: Missing API Key`); // eslint-disable-line no-console
			return;
		}

		if (!origin || !destination) {
			return;
		}

		const timePrecisionString = timePrecision === 'none' ? '' : timePrecision;

		// Routes array which we'll be filling.
		// We'll perform a Directions API Request for reach route
		const routes: Route[] = [];

		// We need to split the waypoints in chunks, in order to not exceede the max waypoint limit
		// ~> Chunk up the waypoints, yielding multiple routes
		if (splitWaypoints && waypoints && waypoints.length > WAYPOINT_LIMIT) {
			// Split up waypoints in chunks with chunksize WAYPOINT_LIMIT
			const chunckedWaypoints = waypoints.reduce((accumulator: Marker[][], waypoint, index) => {
				const numChunk = Math.floor(index / WAYPOINT_LIMIT);
				accumulator[numChunk] = [].concat((accumulator[numChunk] || []), waypoint);
				return accumulator;
			}, []);

			// Create routes for each chunk, using:
			// - Endpoints of previous chunks as startpoints for the route (except for the first chunk, which uses initialOrigin)
			// - Startpoints of next chunks as endpoints for the route (except for the last chunk, which uses initialDestination)
			for (let i = 0; i < chunckedWaypoints.length; i++) {
				routes.push({
					waypoints: chunckedWaypoints[i],
					origin: (i === 0) ? origin : chunckedWaypoints[i - 1][chunckedWaypoints[i - 1].length - 1],
					destination: (i === chunckedWaypoints.length - 1) ? destination : chunckedWaypoints[i + 1][0],
				});
			}
		}

		// No splitting of the waypoints is requested/needed.
		// ~> Use one single route
		else {
			routes.push({
				waypoints: waypoints ?? [],
				origin: origin,
				destination: destination,
			});
		}

		// Perform a Directions API Request for each route
		Promise.all(routes.map((route, index) => {
			let { origin, destination, waypoints } = route;
			let originString = '';
			let destinationString = '';

			if (origin.latitude && origin.longitude) {
				originString = `${origin.latitude},${origin.longitude}`;
			}

			if (destination.latitude && destination.longitude) {
				destinationString = `${destination.latitude},${destination.longitude}`;
			}
			let waypointsString = '';
			if (waypoints) {
				waypointsString = waypoints
					.map(waypoint => (waypoint.latitude && waypoint.longitude) ? `${waypoint.latitude},${waypoint.longitude}` : waypoint)
					.join('|');
			}

			if (optimizeWaypoints) {
				waypointsString = `optimize:true|${waypoints}`;
			}

			if (index === 0) {
				onStart && onStart(
					originString,
					destinationString,
					waypointsString,
				);
			}

			return (
				fetchRoute(directionsServiceBaseUrl, originString, waypointsString, destinationString, apikey, mode, language, region, precision, timePrecisionString, channel)
					.then(result => {
						return result;
					})
					.catch(errorMessage => {
						return Promise.reject(errorMessage);
					})
			);
		})).then(results => {
			// Combine all Directions API Request results into one
			const result = results.reduce((acc: Result, { distance, duration, coordinates, fare, legs, waypointOrder }) => {
				acc.coordinates = [
					...acc.coordinates,
					...coordinates,
				];
				acc.distance += distance;
				acc.duration += duration;
				acc.fares = [
					...acc.fares,
					fare,
				];
				acc.legs = legs;
				acc.waypointOrder = [
					...acc.waypointOrder,
					waypointOrder,
				];

				return acc;
			}, {
				coordinates: [],
				distance: 0,
				duration: 0,
				fares: [],
				legs: [],
				waypointOrder: [],
			});

			// Plot it out and call the onReady callback
			setCoordinates(result.coordinates);
			onReady && onReady(result);
		}).catch(errorMessage => {
			resetState();
			console.warn(`MapDirections Error: ${errorMessage}`); // eslint-disable-line no-console
			onError && onError(errorMessage);
		});
	}

	const fetchRoute = (directionsServiceBaseUrl: string, origin: string, waypoints: string, destination: string, apikey: string, mode: string, language: string, region: string, precision: string, timePrecision: string, channel: string) => {

		// Define the URL to call. Only add default parameters to the URL if it's a string.
		let url = directionsServiceBaseUrl;
		if (typeof (directionsServiceBaseUrl) === 'string') {
			url += `?origin=${origin}&waypoints=${waypoints}&destination=${destination}&key=${apikey}&mode=${mode.toLowerCase()}&language=${language}&region=${region}`;
			if (timePrecision) {
				url += `&departure_time=${timePrecision}`;
			}
			if (channel) {
				url += `&channel=${channel}`;
			}
			if (avoidTolls) {
				url += `&avoid=tolls`;
			}
			if (avoidHighways) {
				url += `&avoid=highways`;
			}
			if (avoidFerries) {
				url += `&avoid=ferries`;
			}
		}

		return fetch(url)
			.then(response => response.json())
			.then(json => {

				if (json.status !== 'OK') {
					const errorMessage = json.error_message || json.status || 'Unknown error';
					return Promise.reject(errorMessage);
				}

				if (json.routes.length) {

					let route = json.routes[0];
					if (filterRoute) {
						let routes = []
						for (let i = 0; i < json.routes.length; i++) {
							routes.push({
								distance: json.routes[i].legs.reduce((carry, curr) => {
									return carry + curr.distance.value;
								}, 0) / 1000,
								duration: json.routes[i].legs.reduce((carry, curr) => {
									return carry + (curr.duration_in_traffic ? curr.duration_in_traffic.value : curr.duration.value);
								}, 0) / 60,
								coordinates: (
									(precision === 'low') ?
										decode([{ polyline: json.routes[i].overview_polyline }]) :
										json.routes[i].legs.reduce((carry, curr) => {
											return [
												...carry,
												...decode(curr.steps),
											];
										}, [])
								),
								fare: json.routes[i].fare,
								waypointOrder: json.routes[i].waypoint_order,
								legs: json.routes[i].legs,
							})
						}
						let selectedRoute = filterRoute(routes)
						route = json.routes[selectedRoute]
					}

					return Promise.resolve({
						distance: route.legs.reduce((carry, curr) => {
							return carry + curr.distance.value;
						}, 0) / 1000,
						duration: route.legs.reduce((carry, curr) => {
							return carry + (curr.duration_in_traffic ? curr.duration_in_traffic.value : curr.duration.value);
						}, 0) / 60,
						coordinates: (
							(precision === 'low') ?
								decode([{ polyline: route.overview_polyline }]) :
								route.legs.reduce((carry, curr) => {
									return [
										...carry,
										...decode(curr.steps),
									];
								}, [])
						),
						fare: route.fare,
						waypointOrder: route.waypoint_order,
						legs: route.legs,
					});

				} else {
					return Promise.reject();
				}
			})
			.catch(err => {
				return Promise.reject(`Error on GMAPS route request: ${err}`);
			});
	}

	return <>
		{coordinates ? <Polyline coordinates={coordinates} {...props} /> : null}
	</>
}
