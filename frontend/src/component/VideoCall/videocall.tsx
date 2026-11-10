import React, { useEffect, useRef, useState } from 'react';
import { useToast } from '@chakra-ui/react';
import { websocketstate, user, apiURL } from '../../recoil/atom';
import { useRecoilValue } from 'recoil';
import axios from 'axios';
import Calling from './Calling';
import LiveCall from './LiveCall';
import { useLocation, useNavigate } from 'react-router-dom';

const Videocall: React.FC = () => {

  const [peerConnection,setperrConnection] = useState<RTCPeerConnection | null>(null);

  function iceconnectionstate(){
    if(peerConnection === null) return;
    const state = peerConnection?.iceConnectionState;

    if(state === "disconnected" || state === "failed" || state === "closed"){
      toast({
        title: 'Call ended',
        description: 'The call has ended',
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
      navigate("/dashboard");
    }
  }

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const intervalRef = useRef<number | null>(null);
  const location = useLocation();
  const dataa = location.state;
  const websocket = useRecoilValue(websocketstate);
  const url = useRecoilValue(apiURL);
  const User = useRecoilValue(user);
  const icecandidatebuffer = useRef<any[]>(dataa.type === "call" ? [] : dataa.icecandidate);

  const [state,setState] = useState(0);

  const toast = useToast();
  const navigate = useNavigate();

  async function connection() {

    if (dataa.type === "call" && websocket && peerConnection) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      websocket.send(JSON.stringify({ type: "offer", offer: offer, userId: dataa.id, name: User.name }));

      setState(1);
      intervalRef.current = setTimeout(() => {
        toast({
          title: 'Call ended',
          description: 'The user did not answer the call',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
        intervalRef.current && clearInterval(intervalRef.current);
        intervalRef.current = null;
        peerConnection.close();
        websocket?.send(JSON.stringify({type:"call-ended",userId: dataa.id || dataa.userId}));
        navigate(-1);
      },30000);
    }
    if(dataa.type === "offer" && peerConnection){
      await acceptCall(dataa,peerConnection);
      setState(1);
    }
  }

  useEffect(() => {
    if(peerConnection && mediaStream){
      mediaStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, mediaStream);
      });
      connection();
    }
  }, [peerConnection]);
  
  async function acceptCall(data: any,peerConnection1:RTCPeerConnection | null) {

      if(peerConnection1){
        await peerConnection1.setRemoteDescription(data.offer);
        await flushIceCandidates(peerConnection1);
        const answer = await peerConnection1.createAnswer();
        await peerConnection1.setLocalDescription(answer);
        websocket?.send(JSON.stringify({ type: "answer", answer: answer, userId: data.userId }));
        
    }
  }

  async function answerCall(data:any,peerConnection:RTCPeerConnection | null){ 

    if( peerConnection ){
      await peerConnection.setRemoteDescription(data.answer);
      await flushIceCandidates(peerConnection);
    }
  }

  useEffect(() => {
    const getUserMedia = async () => {
      try {
        setMediaStream( await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        }))
        
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Failed to access camera',
          status: 'error',
          duration: 5000,
          isClosable: true,
        });
      }
    };

    if(mediaStream === null)getUserMedia();

    return () => {
        mediaStream?.getTracks().forEach(track => track.stop());
    };
  }, [mediaStream]);

  useEffect(()=>{
    if(!mediaStream)return;

    const controller = new AbortController();
    let connection: RTCPeerConnection | null = null;
    axios.get<{ iceServers: RTCIceServer[] }>(`${url}/api/ice-servers`, {
      withCredentials: true,
      timeout: 12000,
      signal: controller.signal,
    }).then(({data}) => {
      if(controller.signal.aborted)return;
      connection = new RTCPeerConnection({ iceServers: data.iceServers });
      setperrConnection(connection);
    }).catch(() => {
      if(controller.signal.aborted)return;
      toast({
        title: 'Unable to start call',
        description: 'Could not connect to the calling service. Please try again.',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
      navigate('/dashboard');
    });

    return () => {
      controller.abort();
      if(connection){
        connection.oniceconnectionstatechange = null;
        connection.close();
      }
    };
  },[mediaStream, url, toast, navigate]);

  useEffect(() => {
    if (websocket) {
      websocket.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        // Handle incoming answer
        if (data.type === "answer") {
          intervalRef.current && clearInterval(intervalRef.current);
          await answerCall(data,peerConnection);
          setState(1);
        }

        // Handle incoming ICE candidates
        if (data.type === "ICEcandidate") {
          await addIceCandidate(data.candidate);
        }
        // Handle call rejection
        if (data.type === "call-rejected") {
          intervalRef.current && clearInterval(intervalRef.current);
          peerConnection?.close();
          setperrConnection(null);
          navigate(-1);
          toast({
            title: 'Call rejected',
            description: data.message || 'The user rejected the call',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        }

        if(data.type === "call-ended"){
          peerConnection?.close();
          setperrConnection(null);
          toast({
            title: 'Call ended',
            description: 'The calll has ended',
            status: 'success',
            duration: 5000,
            isClosable: true,
          });
          navigate(-1);
        }
      };
    }
  }, [websocket,peerConnection]);

  async function flushIceCandidates(connection: RTCPeerConnection){
    const candidates = icecandidatebuffer.current.splice(0);
    for(const candidate of candidates){
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function addIceCandidate(candidate: any){
    if(peerConnection?.remoteDescription){
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }else{
      icecandidatebuffer.current.push(candidate);
    }
  }

  useEffect(() => {
    if(peerConnection){
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          websocket?.send(JSON.stringify({ type: "ICEcandidate", candidate: event.candidate, userId: dataa.id || dataa.userId }));
        }
      };
      peerConnection.oniceconnectionstatechange = iceconnectionstate;
    }

  }, [peerConnection]);

  const endcallfunction = ()=>{
    if(peerConnection){
      peerConnection.close();
      websocket?.send(JSON.stringify({type:"call-ended",userId: dataa.id || dataa.userId}));
      setperrConnection(null);
      toast({
        title: 'Call ended',
        description: 'The call has ended',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      navigate(-1);
    }
  }

  return (
    <div>
      {state === 0 && <Calling name={dataa.name || "e"} mediaStream={mediaStream}/>}
      {state === 1 && <LiveCall peerConnectionRef={peerConnection} mediaStream={mediaStream} endcallfunction={endcallfunction}/>}
    </div>
  )
};

export default Videocall;
