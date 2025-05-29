import dynamic from "next/dynamic";
const Home = dynamic(() => import("../components/HomePage"), { ssr: false });
export default Home;